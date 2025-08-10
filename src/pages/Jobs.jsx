import React, {useEffect, useMemo, useRef, useState} from "react";
import {supabase} from "../lib/superbase.js";
import {useTenant} from "../context/TenantContext.jsx";
import SalesForm from "../features/forms/SalesForm.jsx";
import {captureElementToPdf} from "../features/pdf/service.js";

export default function Jobs(){
  const {tenantId}=useTenant();

  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [active,setActive]=useState([]);
  const [completed,setCompleted]=useState([]);
  const [maps,setMaps]=useState({equip:{}, mats:{}, addons:{}, cust:{}});
  const [editing,setEditing]=useState(null); // null=none, {}=new, row=edit
  const [viewing,setViewing]=useState(null); // completed job row for modal view

  const printRef=useRef(null);

  // ---- reference maps (equip, materials, addons, customers)
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
    try{
      setLoading(true); setError("");
      const [a,c,m]=await Promise.all([
        supabase.from("jobs").select("*").eq("tenant_id", tenantId).order("created_at",{ascending:false}),
        supabase.from("completed_jobs").select("*").eq("tenant_id", tenantId).order("completed_at",{ascending:false}),
        loadMaps()
      ]);
      if(a.error) throw a.error;
      if(c.error) throw c.error;
      setActive(a.data||[]);
      setCompleted(c.data||[]);
      setMaps(m);
    }catch(ex){
      setError(ex.message||"Failed to load jobs");
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{ load(); },[tenantId]);

  // ---- actions
  const onPdf = async (row, kind='jobs')=>{
    if(!printRef.current){ alert('Printable element not found'); return; }
    printRef.current.innerHTML = renderJobHtml({row, maps});
    const {url}=await captureElementToPdf({element: printRef.current, tenantId, kind, code:row.code});
    alert('PDF saved.\n'+url);
  };

  const onDeleteActive = async (row)=>{
    if(!confirm('Delete job?')) return;
    const {error}=await supabase.from('jobs').delete().eq('id', row.id).eq('tenant_id', tenantId);
    if(error){ alert(error.message); return; }
    await load();
  };

  const onComplete = async (row)=>{
    if(!confirm('Complete this job, apply inventory & ink deductions?')) return;
    // server-side transaction (see SQL below)
    const {data,error} = await supabase.rpc('complete_job_and_apply_inventory', {
      p_job_id: row.id, p_tenant_id: tenantId
    });
    if(error){ console.error(error); alert(error.message); return; }
    // success: reload
    await load();
  };

  const onGenerateInvoice = async (row)=>{
    // server-side invoice generation from completed job (see SQL below)
    const {data,error} = await supabase.rpc('generate_invoice_from_completed_job', {
      p_completed_job_id: row.id, p_tenant_id: tenantId
    });
    if(error){ console.error(error); alert(error.message); return; }
    alert(`Invoice ${data?.code||'(unknown)'} generated.`);
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Jobs</h2>
        {/* Was <Link to="/jobs/new"> — that route isn’t defined. Use inline new form instead. */}
        <button className="btn btn-primary" onClick={()=>setEditing({})}>New Job</button>
      </div>

      {editing!==null? (
        <div className="card">
          <SalesForm
            kind="job"
            row={Object.keys(editing).length? editing:null}
            onSaved={()=>{
              setEditing(null);
              load();
            }}
          />
        </div>
      ):null}

      {error? <div className="alert alert-danger" style={{marginTop:8}}>{error}</div> : null}
      {loading? <div className="card">Loading…</div> : null}

      {/* Active Jobs list (cards) */}
      <div className="cards" style={{marginTop:16}}>
        {active.map((j)=>(
          <JobCard
            key={j.id}
            row={j}
            maps={maps}
            onEdit={()=>setEditing(j)}
            onPdf={()=>onPdf(j, 'jobs')}
            onComplete={()=>onComplete(j)}
            onDelete={()=>onDeleteActive(j)}
          />
        ))}
        {!loading && active.length===0? <div className="tiny">No active jobs.</div> : null}
      </div>

      {/* Completed Jobs table */}
      <div className="table-wrap" style={{marginTop:24}}>
        <h3 style={{margin:'6px 0 12px'}}>Completed Jobs</h3>
        <table id="completed-jobs-table">
          <thead>
            <tr>
              <th>Job #</th>
              <th>Title</th>
              <th>Completed</th>
              <th>Total</th>
              <th style={{textAlign:'right'}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {completed.map((r)=>(
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td>{r.title}</td>
                <td>{r.completed_at? new Date(r.completed_at).toLocaleString() : '—'}</td>
                <td>${Number(r.totals?.totalCharge??0).toFixed(2)}</td>
                <td style={{textAlign:'right'}}>
                  <div className="btn-row" style={{justifyContent:'flex-end'}}>
                    <button className="btn" onClick={()=>setViewing(r)}>Job Details</button>
                    <button className="btn" onClick={()=>onPdf(r,'completed-jobs')}><i className="fa-regular fa-file-pdf"/> PDF</button>
                    <button className="btn btn-secondary" onClick={()=>onGenerateInvoice(r)}>Generate Invoice</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && completed.length===0? (
              <tr><td colSpan={5} className="tiny">No completed jobs.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* View modal for completed job */}
      {viewing? (
        <JobViewModal
          row={viewing}
          maps={maps}
          onClose={()=>setViewing(null)}
          onPdf={()=>onPdf(viewing,'completed-jobs')}
          onGenerateInvoice={()=>onGenerateInvoice(viewing)}
        />
      ) : null}

      <div ref={printRef} style={{position:'fixed', left:-9999, top:-9999}}/>
    </section>
  );
}

/* ============================ Active job card ============================ */

function JobCard({row, maps, onEdit, onPdf, onComplete, onDelete}){
  const sum = useMemo(()=>summarize(row, maps),[row, maps]);
  const created = row.created_at? new Date(row.created_at) : null;

  return (
    <div className="job-card">
      <div className="info-column">
        <h4 style={{marginBottom:6}}>
          {row.title} <span className="tiny mono">#{row.code}</span>
          <span className={`badge ${row.status==='active'?'active-status':'completed-status'}`} style={{marginLeft:8}}>{row.status||'active'}</span>
        </h4>
        <div className="tiny" style={{marginBottom:6}}>
          {created? created.toLocaleString() : ''} • {sum.customerLabel}
        </div>

        {/* Mini breakdown similar to Quotes */}
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
          <button className="btn" onClick={onPdf}><i className="fa-regular fa-file-pdf"/> PDF</button>
          <button className="btn btn-secondary" onClick={onComplete}>Complete</button>
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

/* ============================ Completed job modal ============================ */

function JobViewModal({row, maps, onClose, onPdf, onGenerateInvoice}){
  const sum = useMemo(()=>summarize(row, maps),[row, maps]);
  const completed = row.completed_at? new Date(row.completed_at) : null;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3 style={{margin:0}}>Job <span className="tiny mono">#{row.code}</span></h3>
        <div className="btn-row">
            <button className="btn" onClick={onPdf}><i className="fa-regular fa-file-pdf"/> PDF</button>
            <button className="btn btn-secondary" onClick={onGenerateInvoice}>Generate Invoice</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="tiny" style={{margin:'6px 0 16px'}}>
          {completed? completed.toLocaleString() : ''} • {sum.customerLabel}
        </div>

        <SectionList title="Equipment" lines={sum.eqLines}/>
        {sum.inkDots.length? (
          <div className="tiny" style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:8}}>
            <b>Ink:</b>
            {sum.inkDots.map((d,i)=><InkDot key={i} color={d.color} label={`${d.key}:${d.val}`}/>)}
            <span className="tiny">Total {sum.inkTotal}</span>
          </div>
        ):null}
        <SectionList title="Materials" lines={sum.matLines}/>
        <SectionList title="Labor" lines={sum.laborLines}/>
        <SectionList title="Add-ons" lines={sum.addonLines}/>

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

function SectionList({title, lines}){
  return (
    <div className="section">
      <h4 style={{margin:'0 0 8px'}}>{title}</h4>
      {lines.length===0? <div className="tiny">None</div> : (
        <ul style={{margin:'0 0 0 18px'}}>{lines.map((s,i)=><li key={i}>{s}</li>)}</ul>
      )}
    </div>
  );
}

/* ============================ Shared summarize (same colors as Quotes) ============================ */

function summarize(row, maps){
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

/* ============================ PDF HTML ============================ */

function renderJobHtml({row, maps}){
  const sum=summarize(row, maps);
  return `
  <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
    <div style="display:flex; justify-content:space-between;">
      <div>
        <h2 style="margin:0 0 6px 0;">${row.status==='completed'?'Completed Job':'Job'}</h2>
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
