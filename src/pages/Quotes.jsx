import {useEffect, useMemo, useRef, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import SalesForm from '../features/forms/SalesForm.jsx';
import {captureElementToPdf} from '../features/pdf/service.js';

export default function Quotes(){
  const {tenantId}=useTenant();

  const [rows,setRows]=useState([]);
  const [editing,setEditing]=useState(null); // null=none, {}=new, row=edit
  const [viewing,setViewing]=useState(null); // row for View modal
  const [maps,setMaps]=useState({equip:{}, mats:{}, addons:{}, cust:{}});
  const printRef=useRef(null);

  const loadMaps=async ()=>{
    if(!tenantId) return {equip:{}, mats:{}, addons:{}, cust:{}};
    const [eq,ma,ad,cu] = await Promise.all([
      supabase.from('equipments').select('id,name,type').eq('tenant_id', tenantId),
      supabase.from('materials').select('id,name,purchase_price,selling_price').eq('tenant_id', tenantId),
      supabase.from('addons').select('id,name').eq('tenant_id', tenantId),
      supabase.from('customers').select('id,name,company,email').eq('tenant_id', tenantId),
    ]);
    const equip={}; (eq.data||[]).forEach((r)=>equip[r.id]=r);
    const mats={}; (ma.data||[]).forEach((r)=>mats[r.id]=r);
    const addons={}; (ad.data||[]).forEach((r)=>addons[r.id]=r);
    const cust={}; (cu.data||[]).forEach((r)=>cust[r.id]=r);
    return {equip, mats, addons, cust};
  };

  const load=async ()=>{
    if(!tenantId) return;
    const [{data,error}, mm]=await Promise.all([
      supabase.from('quotes')
        .select('*')
        .eq('tenant_id', tenantId)
        .neq('status','converted') // 1) hide converted quotes
        .order('created_at',{ascending:false}),
      loadMaps()
    ]);
    if(!error) setRows(data||[]);
    setMaps(mm);
  };

  useEffect(()=>{ load(); },[tenantId]);

  const convertToJob = async (quote)=>{
    try{
      const {data:codeRow, error:codeErr} = await supabase
        .rpc("allocate_code", {p_kind: "job", p_tenant_id: tenantId})
        .single();
      if(codeErr) throw codeErr;

      const payload = {
        tenant_id: tenantId,
        code: codeRow?.code,
        title: quote.title,
        customer_id: quote.customer_id,
        status: "active",
        items: quote.items,
        totals: quote.totals
      };
      const ins = await supabase.from("jobs").insert(payload).select("*").single();
      if(ins.error) throw ins.error;

      // delete the quote so it disappears entirely (you asked to remove it)
      const del = await supabase.from("quotes")
        .delete()
        .eq("id", quote.id)
        .eq("tenant_id", tenantId);
      if(del.error) throw del.error;

      alert(`Converted to Job ${ins.data.code}`);
      await load();
    }catch(ex){
      console.error(ex);
      alert(ex.message || "Conversion failed");
    }
  };

  const onPdf = async (row)=>{
    if(!printRef.current){ alert('Printable element not found'); return; }
    printRef.current.innerHTML = renderQuoteHtml({row, maps});
    const {url}=await captureElementToPdf({element: printRef.current, tenantId, kind:'quotes', code:row.code});
    alert('Quote PDF saved.\n'+url);
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Quotes</h2>
        <button className="btn btn-primary" onClick={()=>setEditing({})}>New Quote</button>
      </div>

      {editing!==null? (
        <div className="card">
          <SalesForm
            kind="quote"
            row={Object.keys(editing).length? editing:null}
            onSaved={()=>{
              setEditing(null);
              load();
            }}
          />
        </div>
      ):null}

      <div className="cards" style={{marginTop:16}}>
        {(rows||[]).map((r)=>(
          <QuoteCard
            key={r.id}
            row={r}
            maps={maps}
            onEdit={()=>setEditing(r)}
            onView={()=>setViewing(r)}
            onConvert={()=>convertToJob(r)}
            onDelete={async ()=>{
              if(!confirm('Delete quote?')) return;
              await supabase.from('quotes').delete().eq('id', r.id).eq('tenant_id', tenantId);
              load();
            }}
          />
        ))}
        {rows.length===0? <div className="tiny">No quotes yet.</div> : null}
      </div>

      {viewing? (
        <QuoteViewModal
          row={viewing}
          maps={maps}
          onClose={()=>setViewing(null)}
          onPdf={()=>onPdf(viewing)}
        />
      ) : null}

      <div ref={printRef} style={{position:'fixed', left:-9999, top:-9999}}/>
    </section>
  );
}

/* ============================ Quote Card ============================ */

function QuoteCard({row, maps, onEdit, onView, onConvert, onDelete}){
  const sum = useMemo(()=>summarizeQuote(row, maps),[row, maps]);
  const created = row.created_at? new Date(row.created_at) : null;

  return (
    <div className="job-card">
      <div className="info-column">
        <h4 style={{marginBottom:6}}>
          {row.title} <span className="tiny mono">#{row.code}</span>
        </h4>
        <div className="tiny" style={{marginBottom:6}}>
          {created? created.toLocaleString() : ''} • {sum.customerLabel}
        </div>

        {/* 2) Mini breakdown */}
        <div className="tiny" style={{marginBottom:6}}>
          {sum.eqLines.length? <b>Equipment:</b> : null} {sum.eqLabel}
        </div>
        {sum.inkDots.length? (
          <div className="tiny" style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', margin:'2px 0 6px'}}>
            <b>Ink:</b>
            {sum.inkDots.map((d,i)=>(
              <InkDot key={i} color={d.color} label={`${d.key}:${d.val}`} />
            ))}
            <span className="tiny">Total {sum.inkTotal}</span>
          </div>
        ) : null}

        <div className="tiny" style={{marginBottom:4}}>
          {sum.matLabel? (<><b>Materials:</b> {sum.matLabel}</>) : null}
        </div>
        <div className="tiny" style={{marginBottom:4}}>
          {sum.laborLabel? (<><b>Labor:</b> {sum.laborLabel}</>) : null}
        </div>
        <div className="tiny" style={{marginBottom:10}}>
          {sum.addonLabel? (<><b>Add-ons:</b> {sum.addonLabel}</>) : null}
        </div>

        <div className="row" style={{gap:12}}>
          <div className="tiny"><b>Total:</b> ${Number(row.totals?.totalCharge??0).toFixed(2)}</div>
          <div className="tiny"><b>Profit:</b> ${Number(row.totals?.profit??0).toFixed(2)}</div>
        </div>

        <div className="buttons" style={{marginTop:10}}>
          <button className="btn" onClick={onEdit}>Edit</button>
          <button className="btn" onClick={onView}>View</button>
          <button className="btn btn-secondary" onClick={onConvert}>Convert to Job</button>
          <button className="btn btn-danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function InkDot({color,label}){
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
      <span style={{
        width:12, height:12, borderRadius:999,
        background:color, border:'1px solid rgba(0,0,0,.15)', display:'inline-block'
      }}/>
      <span className="tiny mono">{label}</span>
    </span>
  );
}

/* ============================ View Modal + PDF ============================ */

function QuoteViewModal({row, maps, onClose, onPdf}){
  const sum = useMemo(()=>summarizeQuote(row, maps),[row, maps]);
  const created = row.created_at? new Date(row.created_at) : null;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3 style={{margin:0}}>Quote <span className="tiny mono">#{row.code}</span></h3>
          <div className="btn-row">
            <button className="btn" onClick={onPdf}><i className="fa-regular fa-file-pdf"/> PDF</button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="tiny" style={{margin:'6px 0 16px'}}>
          {created? created.toLocaleString() : ''} • {sum.customerLabel}
        </div>

        {/* Equipments */}
        <div className="section">
          <h4 style={{margin:'0 0 8px'}}>Equipment</h4>
          {sum.eqLines.length===0? <div className="tiny">None</div> : (
            <ul style={{margin:'0 0 0 18px'}}>
              {sum.eqLines.map((s,i)=>(
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          {sum.inkDots.length? (
            <div className="tiny" style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:8}}>
              <b>Ink:</b>
              {sum.inkDots.map((d,i)=>(
                <InkDot key={i} color={d.color} label={`${d.key}:${d.val}`} />
              ))}
              <span className="tiny">Total {sum.inkTotal}</span>
            </div>
          ):null}
        </div>

        {/* Materials */}
        <div className="section">
          <h4 style={{margin:'0 0 8px'}}>Materials</h4>
          {sum.matLines.length===0? <div className="tiny">None</div> : (
            <ul style={{margin:'0 0 0 18px'}}>
              {sum.matLines.map((s,i)=><li key={i}>{s}</li>)}
            </ul>
          )}
        </div>

        {/* Labor */}
        <div className="section">
          <h4 style={{margin:'0 0 8px'}}>Labor</h4>
          {sum.laborLines.length===0? <div className="tiny">None</div> : (
            <ul style={{margin:'0 0 0 18px'}}>
              {sum.laborLines.map((s,i)=><li key={i}>{s}</li>)}
            </ul>
          )}
        </div>

        {/* Add-ons */}
        <div className="section">
          <h4 style={{margin:'0 0 8px'}}>Add-ons</h4>
          {sum.addonLines.length===0? <div className="tiny">None</div> : (
            <ul style={{margin:'0 0 0 18px'}}>
              {sum.addonLines.map((s,i)=><li key={i}>{s}</li>)}
            </ul>
          )}
        </div>

        {/* Totals */}
        <div className="card" style={{marginTop:12}}>
          <div className="grid-3">
            <div><strong>Cost:</strong><br/>${Number(row.totals?.totalCost??0).toFixed(2)}</div>
            <div><strong>Charge (pre-tax):</strong><br/>${Number(row.totals?.totalCharge??0).toFixed(2)}</div>
            <div><strong>Profit:</strong><br/>${Number(row.totals?.profit??0).toFixed(2)} ({Number(row.totals?.profitPct??0).toFixed(1)}%)</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================ Helpers ============================ */

function summarizeQuote(row, maps){
  const items=row.items||{};
  const eq=(items.equipments||[]);
  const mats=(items.materials||[]);
  const ad=(items.addons||[]);
  const lab=(items.labor||[]);
  const UV_TYPES=new Set(["UV Printer","Sublimation Printer"]);

  // customer
  const cust = maps.cust[row.customer_id];
  const customerLabel = cust? (cust.company? `${cust.company} — ${cust.name}` : cust.name) : '(Customer)';

  // equipment label lines
  const eqLines=[];
  const inkDots=[];
  let inkTotal=0;

  const colorMap=[
    {key:'c', color:'#00b5ff', label:'C'},
    {key:'m', color:'#ff3ea5', label:'M'},
    {key:'y', color:'#ffd400', label:'Y'},
    {key:'k', color:'#000000', label:'K'},
    {key:'white', color:'#ffffff', label:'W'},
    {key:'soft_white', color:'#f0f0f0', label:'SW'},
    {key:'gloss', color:'#cfcfcf', label:'G'},
  ];

  for(const l of eq){
    const e = maps.equip[l.equipment_id];
    const name = e? (e.type? `${e.name} (${e.type})` : e.name) : '(Equipment)';
    if(UV_TYPES.has(l.type||e?.type)){
      // gather inks
      const inks=l.inks||{};
      colorMap.forEach(({key,color,label})=>{
        const val=Number(inks[key]||0);
        if(val>0){
          inkDots.push({key:label, color, val:val.toString()});
          inkTotal += val;
        }
      });
      eqLines.push(`${name} • UV/Sublimation`);
    }else{
      if(l.mode==='hourly'){
        eqLines.push(`${name} • ${Number(l.hours||0)}h × ${fmt$(l.rate)} = ${fmt$(Number(l.hours||0)*Number(l.rate||0))}`);
      }else{
        eqLines.push(`${name} • Flat ${fmt$(l.flat_fee)}`);
      }
    }
  }

  const matLines = mats.map((m)=>{
    const mm = maps.mats[m.material_id];
    const nm = mm? mm.name : '(Material)';
    return `${nm} × ${Number(m.qty||0)}`;
  });
  const addonLines = ad.map((a)=>{
    const aa = maps.addons[a.addon_id];
    const nm = aa? aa.name : '(Add-on)';
    const qty=Number(a.qty||0), price=Number(a.price||0);
    return `${nm} × ${qty} @ ${fmt$(price)} = ${fmt$(qty*price)}`;
  });
  const laborLines = lab.map((l)=>{
    const hrs=Number(l.hours||0), rt=Number(l.rate||0);
    return `${l.desc||'Labor'} • ${hrs}h × ${fmt$(rt)} = ${fmt$(hrs*rt)}`;
  });

  const matLabel = matLines.join(', ');
  const addonLabel = addonLines.join(', ');
  const laborLabel = laborLines.join(', ');
  const eqLabel = eqLines.join(', ');

  return {
    customerLabel,
    eqLines, eqLabel,
    inkDots,
    inkTotal: inkTotal.toString(),
    matLines, matLabel,
    addonLines, addonLabel,
    laborLines, laborLabel
  };
}

function fmt$(n){ const v=Number(n||0); return `$${v.toFixed(2)}`; }

/* For PDF: reuse your PO approach and render a clean HTML snapshot */
function renderQuoteHtml({row, maps}){
  const sum=summarizeQuote(row, maps);
  return `
  <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
    <div style="display:flex; justify-content:space-between;">
      <div>
        <h2 style="margin:0 0 6px 0;">Quote</h2>
        <div style="font:12px monospace; color:#555"># ${esc(row.code||'')}</div>
      </div>
      <div style="text-align:right; font-size:12px; color:#555;">
        ${esc(sum.customerLabel||'')}
      </div>
    </div>

    <div style="margin:12px 0; height:1px; background:#eee;"></div>

    <h3 style="margin:10px 0 6px;">Equipment</h3>
    ${sum.eqLines.length? `<ul style="margin:0 0 0 18px;">${sum.eqLines.map(li=>`<li>${esc(li)}</li>`).join('')}</ul>` : `<div style="font-size:12px;color:#666">None</div>`}

    ${sum.inkDots.length? `
      <div style="margin-top:8px; font-size:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <b>Ink:</b>
        ${sum.inkDots.map(d=>`
          <span style="display:inline-flex; align-items:center; gap:6px;">
            <span style="width:12px; height:12px; border-radius:999px; display:inline-block; border:1px solid rgba(0,0,0,.15); background:${d.color}"></span>
            <span style="font-family:monospace">${esc(d.key)}:${esc(String(d.val))}</span>
          </span>
        `).join('')}
        <span>Total ${esc(sum.inkTotal)}</span>
      </div>
    `:''}

    <h3 style="margin:16px 0 6px;">Materials</h3>
    ${sum.matLines.length? `<ul style="margin:0 0 0 18px;">${sum.matLines.map(li=>`<li>${esc(li)}</li>`).join('')}</ul>` : `<div style="font-size:12px;color:#666">None</div>`}

    <h3 style="margin:16px 0 6px;">Labor</h3>
    ${sum.laborLines.length? `<ul style="margin:0 0 0 18px;">${sum.laborLines.map(li=>`<li>${esc(li)}</li>`).join('')}</ul>` : `<div style="font-size:12px;color:#666">None</div>`}

    <h3 style="margin:16px 0 6px;">Add-ons</h3>
    ${sum.addonLines.length? `<ul style="margin:0 0 0 18px;">${sum.addonLines.map(li=>`<li>${esc(li)}</li>`).join('')}</ul>` : `<div style="font-size:12px;color:#666">None</div>`}

    <div style="margin:12px 0; height:1px; background:#eee;"></div>

    <table style="width:100%; font-size:14px;">
      <tr><td style="padding:4px 0;"><b>Cost</b></td><td style="text-align:right;">${fmt$(row.totals?.totalCost||0)}</td></tr>
      <tr><td style="padding:4px 0;"><b>Charge (pre-tax)</b></td><td style="text-align:right;">${fmt$(row.totals?.totalCharge||0)}</td></tr>
      <tr><td style="padding:4px 0;"><b>Profit</b></td><td style="text-align:right;">${fmt$(row.totals?.profit||0)} (${Number(row.totals?.profitPct||0).toFixed(1)}%)</td></tr>
    </table>
  </div>
  `;
}

function esc(s){ return String(s||'').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
