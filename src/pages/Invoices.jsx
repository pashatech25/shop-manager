import {useEffect, useMemo, useRef, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import InvoiceEditor from '../features/invoices/Editor.jsx';
import Spinner from '../features/ui/Spinner.jsx';
import Confirm from '../features/ui/Confirm.jsx';
import {captureElementToPdf} from '../features/pdf/service.js';

export default function Invoices(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [settings,setSettings]=useState(null);
  const [loading,setLoading]=useState(true);
  const [editId,setEditId]=useState(null);
  const [emailFor,setEmailFor]=useState(null);
  const [viewRow,setViewRow]=useState(null);           // <-- view modal
  const [viewCustomer,setViewCustomer]=useState(null);  // <-- customer in view modal
  const printRef=useRef(null);

  const load=async ()=>{
    if(!tenantId) return;
    setLoading(true);
    const [{data:inv},{data:st}] = await Promise.all([
      supabase.from('invoices').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false}),
      supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle()
    ]);
    setRows(inv||[]); setSettings(st||null); setLoading(false);
  };
  useEffect(()=>{ load(); },[tenantId]);

  const onSaved=()=>{ setEditId(null); load(); };

  const openView=async (row)=>{
    setViewRow(row);
    setViewCustomer(null);
    if(row?.customer_id){
      const {data}=await supabase.from('customers').select('id,company,name,email,phone,address,website').eq('id', row.customer_id).maybeSingle();
      setViewCustomer(data||null);
    }
  };

  const generatePdf=async (row)=>{
    const el=printRef.current;
    if(!el){ alert('Printable element not found'); return; }
    el.innerHTML = renderInvoiceHtml({row, settings, customer:viewCustomer});
    const {url}=await captureElementToPdf({element: el, tenantId, kind:'invoices', code:row.code});
    await supabase.from('invoices').update({pdf_path:`${tenantId}/invoices/${row.code}.pdf`, pdf_updated_at:new Date().toISOString()}).eq('id', row.id);
    alert('PDF saved. A signed URL was generated for 1 hour:\n'+url);
    await load();
  };

  const sendEmail=async (row, to)=>{
    const subject=`Invoice ${row.code}`;
    const html=renderEmailHtml({row, settings});
    const {error}=await supabase.functions.invoke('email-doc', {body:{to, subject, html}});
    if(error){ alert(error.message); return; }
    alert('Email sent.');
    setEmailFor(null);
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Invoices</h2>
        {loading? <Spinner label="Loading"/> : <span className="tiny">{rows.length} invoices</span>}
      </div>

      <div className="table-wrap">
        <table id="invoices-table" className="table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Created</th>
              <th>Total</th>
              <th>PDF</th>
              <th style={{textAlign:'right'}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows||[]).map((r)=>(
              <tr key={r.id}>
                <td className="mono">{r.code}</td>
                <td>{fmtDate(r.created_at)}</td>
                <td>${coalesceTotal(r).toFixed(2)}</td>
                <td>{r.pdf_path? <span className="tiny mono">{r.pdf_path}</span> : <span className="tiny">—</span>}</td>
                <td style={{textAlign:'right'}}>
                  <div className="btn-row" style={{justifyContent:'flex-end'}}>
                    <button className="btn" onClick={()=>openView(r)}>View</button>
                    <button className="btn btn-outline-primary" onClick={()=>setEditId(r.id)}>Edit</button>
                    <button className="btn" onClick={()=>{ setViewCustomer(null); openView(r).then(()=>generatePdf(r)); }}>
                      <i className="fa-regular fa-file-pdf"/> PDF
                    </button>
                    <button className="btn" onClick={()=>setEmailFor(r)}><i className="fa-regular fa-envelope"/> Email</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && rows.length===0?(
              <tr><td colSpan={5} className="tiny">No invoices yet.</td></tr>
            ):null}
          </tbody>
        </table>
      </div>

      {/* Hidden printable area */}
      <div ref={printRef} style={{position:'fixed', left:-9999, top:-9999}}/>

      {/* Edit drawer/modal */}
      {editId? <InvoiceEditor invoiceId={editId} onClose={onSaved}/> : null}

      {/* View modal */}
      {viewRow? (
        <ViewInvoiceModal
          row={viewRow}
          customer={viewCustomer}
          settings={settings}
          onClose={()=>{ setViewRow(null); setViewCustomer(null); }}
        />
      ) : null}

      {/* Email prompt */}
      <Confirm
        open={!!emailFor}
        title={`Email ${emailFor?.code}`}
        message={(
          <span>
            <label className="tiny">Recipient</label>
            <input id="invmail" type="email" placeholder="name@example.com" style={{width:'100%'}} defaultValue="" />
          </span>
        )}
        onYes={()=>{
          const to=document.getElementById('invmail')?.value?.trim();
          if(!to) return alert('Enter an email');
          sendEmail(emailFor, to);
        }}
        onNo={()=>setEmailFor(null)}
      />
    </section>
  );
}

/* ---------- View modal (read-only detail with full breakdown) ---------- */
function ViewInvoiceModal({row, customer, settings, onClose}){
  const items=row?.items||{};
  const eq=Array.isArray(items.equipments)? items.equipments: [];
  const mats=Array.isArray(items.materials)? items.materials: [];
  const adds=Array.isArray(items.addons)? items.addons: [];
  const labs=Array.isArray(items.labor)? items.labor: [];

  const totals=row?.totals||{};
  const preTax=Number(totals.totalChargePreTax ?? totals.totalCharge ?? 0);
  const tax=Number(totals.tax ?? 0);
  const total=Number(totals.grandTotal ?? totals.totalAfterTax ?? preTax+tax);
  const deposit=Number(row?.deposit ?? 0);
  const due=Number(totals.totalDue ?? total - deposit);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3 style={{margin:0}}>Invoice <span className="tiny mono">#{row?.code}</span></h3>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Header / parties */}
        <div className="grid-2" style={{marginTop:12}}>
          <div className="card">
            <div style={{fontWeight:700, marginBottom:6}}>{settings?.business_name || 'Shop Manager'}</div>
            <div className="tiny">{settings?.business_email}</div>
            <div className="tiny">{settings?.business_phone}</div>
            <div className="tiny">{settings?.business_address}</div>
          </div>
          <div className="card">
            <div style={{fontWeight:700, marginBottom:6}}>Bill To</div>
            <div>{customer?.company || customer?.name || '—'}</div>
            <div className="tiny">{customer?.email}</div>
            <div className="tiny">{customer?.phone}</div>
            <div className="tiny">{customer?.address}</div>
          </div>
        </div>

        {/* Items breakdown */}
        <div className="card" style={{marginTop:12}}>
          <h4 style={{marginTop:0}}>Items</h4>

          {/* Equipments (including UV ink usage) */}
          {eq.length>0? (
            <>
              <h5 style={{margin:'8px 0'}}>Equipment</h5>
              <table className="table">
                <thead><tr>
                  <th>Equipment</th>
                  <th>Mode / Detail</th>
                  <th style={{textAlign:'right'}}>Charge</th>
                </tr></thead>
                <tbody>
                  {eq.map((l,i)=>{
                    const type=(l.type||'').toLowerCase();
                    const isUV = type.includes('uv') || type.includes('sublimation');
                    let detail='—';
                    if(isUV){
                      const ink=l.inks||{};
                      const using = l.use_soft_white? 'soft_white':'white';
                      const parts=[
                        ink.c>0? `C:${n4(ink.c)}ml`:null,
                        ink.m>0? `M:${n4(ink.m)}ml`:null,
                        ink.y>0? `Y:${n4(ink.y)}ml`:null,
                        ink.k>0? `K:${n4(ink.k)}ml`:null,
                        ink.gloss>0? `Gloss:${n4(ink.gloss)}ml`:null,
                        ink[using]>0? `${using==='white'?'White':'Soft White'}:${n4(ink[using])}ml`:null
                      ].filter(Boolean).join(' • ');
                      detail = parts || 'Ink usage';
                    }else{
                      detail = (l.mode==='hourly')? `${l.hours||0}h × $${n2(l.rate)}` : `Flat $${n2(l.flat_fee)}`;
                    }
                    const charge = Number(l.charge ?? 0); // when Editor computes/finalizes, you may store charge per line
                    return (
                      <tr key={i}>
                        <td>{l.name || l.type || 'Equipment'}</td>
                        <td>{detail}</td>
                        <td style={{textAlign:'right'}}>${n2(charge)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ):null}

          {/* Materials */}
          {mats.length>0? (
            <>
              <h5 style={{margin:'8px 0'}}>Materials</h5>
              <table className="table">
                <thead><tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th style={{textAlign:'right'}}>Unit (Sell)</th>
                  <th style={{textAlign:'right'}}>Line</th>
                </tr></thead>
                <tbody>
                  {mats.map((m,i)=>{
                    const qty=Number(m.qty||0);
                    const unit=Number(m.selling_price ?? m.unit ?? 0);
                    const line=qty*unit;
                    return (
                      <tr key={i}>
                        <td>{m.name || m.description || 'Material'}</td>
                        <td>{qty}</td>
                        <td style={{textAlign:'right'}}>${n2(unit)}</td>
                        <td style={{textAlign:'right'}}>${n2(line)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ):null}

          {/* Labor */}
          {labs.length>0? (
            <>
              <h5 style={{margin:'8px 0'}}>Labor</h5>
              <table className="table">
                <thead><tr>
                  <th>Description</th>
                  <th>Hours</th>
                  <th style={{textAlign:'right'}}>Rate</th>
                  <th style={{textAlign:'right'}}>Line</th>
                </tr></thead>
                <tbody>
                  {labs.map((l,i)=>{
                    const hours=Number(l.hours||0);
                    const rate=Number(l.rate||0);
                    return (
                      <tr key={i}>
                        <td>{l.desc||'Labor'}</td>
                        <td>{n2(hours)}</td>
                        <td style={{textAlign:'right'}}>${n2(rate)}</td>
                        <td style={{textAlign:'right'}}>${n2(hours*rate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ):null}

          {/* Add-ons */}
          {adds.length>0? (
            <>
              <h5 style={{margin:'8px 0'}}>Add-ons</h5>
              <table className="table">
                <thead><tr>
                  <th>Name</th>
                  <th>Qty</th>
                  <th style={{textAlign:'right'}}>Price</th>
                  <th style={{textAlign:'right'}}>Line</th>
                </tr></thead>
                <tbody>
                  {adds.map((a,i)=>{
                    const qty=Number(a.qty||0);
                    const price=Number(a.price||0);
                    return (
                      <tr key={i}>
                        <td>{a.name || a.description || 'Add-on'}</td>
                        <td>{qty}</td>
                        <td style={{textAlign:'right'}}>${n2(price)}</td>
                        <td style={{textAlign:'right'}}>${n2(qty*price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ):null}
        </div>

        {/* Totals */}
        <div className="grid-2" style={{marginTop:12}}>
          <div className="card">
            <div style={{fontSize:12,color:'#666'}}>Memo</div>
            <div style={{whiteSpace:'pre-wrap'}}>{row?.memo||'—'}</div>
          </div>
          <div className="card">
            <Row label="Pre-tax" val={preTax}/>
            <Row label="Tax" val={tax}/>
            {Number(row?.discount_amount||0)!==0? <Row label="Discount" val={-Math.abs(Number(row.discount_amount))}/> : null}
            <Row label="Deposit" val={-Math.abs(deposit)}/>
            <div style={{height:1, background:'#eee', margin:'8px 0'}}/>
            <Row label="Total" val={total} bold/>
            <Row label="Amount Due" val={due} bold/>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({label,val,bold}){
  return (
    <div style={{display:'flex', justifyContent:'space-between', margin:'4px 0', fontWeight:bold?700:500}}>
      <span>{label}</span><span>${n2(val)}</span>
    </div>
  );
}

/* ---------- helpers ---------- */
function fmtDate(s){ try{ return new Date(s).toLocaleString(); }catch{ return s||''; } }
function n2(x){ return Number(x||0).toFixed(2); }
function n4(x){ return Number(x||0).toFixed(4); }
function coalesceTotal(row){
  const t=row?.totals||{};
  return Number(t.grandTotal ?? t.totalAfterTax ?? t.total ?? t.totalCharge ?? 0);
}

/* ---------- printable html (simple) ---------- */
function renderInvoiceHtml({row, settings, customer}){
  const totals=row?.totals||{};
  const preTax=Number(totals.totalChargePreTax ?? totals.totalCharge ?? 0).toFixed(2);
  const tax=Number(totals.tax ?? 0).toFixed(2);
  const total=Number(totals.grandTotal ?? totals.totalAfterTax ?? preTax).toFixed(2);
  const dep=Number(row?.deposit ?? 0).toFixed(2);
  const due=Number(totals.totalDue ?? (Number(total)-Number(dep))).toFixed(2);

  return `
  <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div>
        <h2 style="margin:0 0 6px 0;">${escapeHtml(settings?.business_name || 'Shop Manager')}</h2>
        <div style="font-size:12px; color:#555">${escapeHtml(settings?.business_email || '')}</div>
        <div style="font-size:12px; color:#555">${escapeHtml(settings?.business_phone || '')}</div>
        <div style="font-size:12px; color:#555">${escapeHtml(settings?.business_address || '')}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:28px; font-weight:700;">INVOICE</div>
        <div style="font-family:ui-monospace,Menlo,Consolas,monospace"># ${escapeHtml(row.code)}</div>
        <div style="font-size:12px; color:#555">${new Date(row.created_at).toLocaleDateString()}</div>
      </div>
    </div>

    <div style="margin:18px 0; height:1px; background:#eee;"></div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div style="padding:12px; border:1px solid #eee; border-radius:8px;">
        <div style="font-size:12px; color:#666; margin-bottom:6px;">Bill To</div>
        <div>${escapeHtml(customer?.company || customer?.name || '')}</div>
        <div style="font-size:12px; color:#555">${escapeHtml(customer?.email || '')}</div>
        <div style="font-size:12px; color:#555">${escapeHtml(customer?.phone || '')}</div>
        <div style="font-size:12px; color:#555">${escapeHtml(customer?.address || '')}</div>
      </div>
      <div style="padding:12px; border:1px solid #eee; border-radius:8px;">
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Pre-tax</span><b>$${preTax}</b></div>
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Tax</span><b>$${tax}</b></div>
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Deposit</span><b>-$${dep}</b></div>
        <div style="height:1px; background:#eee; margin:8px 0"></div>
        <div style="display:flex; justify-content:space-between; margin:8px 0; font-size:18px;"><span>Total</span><b>$${total}</b></div>
        <div style="display:flex; justify-content:space-between; margin:8px 0; font-size:18px;"><span>Amount Due</span><b>$${due}</b></div>
      </div>
    </div>

    <div style="margin-top:18px; padding:12px; border:1px solid #eee; border-radius:8px;">
      <div style="font-size:12px; color:#666;">Memo</div>
      <div style="white-space:pre-wrap; font-size:14px;">${escapeHtml(row.memo||'')}</div>
    </div>
  </div>`;
}

function renderEmailHtml({row, settings}){
  const total=coalesceTotal(row).toFixed(2);
  return `
    <div style="font-family:Arial; color:#111">
      <p>Hi,</p>
      <p>Please find your invoice <b>${escapeHtml(row.code)}</b> from <b>${escapeHtml(settings?.business_name||'Shop Manager')}</b>.</p>
      <p><b>Total:</b> $${total}</p>
      <p>Thank you!</p>
    </div>
  `;
}

function escapeHtml(str){
  return String(str||'').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
