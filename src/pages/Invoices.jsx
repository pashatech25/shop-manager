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
  const [emailFor,setEmailFor]=useState(null); // invoice row to email
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

  const generatePdf=async (row)=>{
    const el=printRef.current;
    if(!el){ alert('Printable element not found'); return; }
    // Fill the printable DOM with simple content for now
    el.innerHTML = renderInvoiceHtml({row, settings});
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
        <table id="invoices-table">
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
                <td>${(r.totals?.grandTotal ?? r.totals?.totalAfterTax ?? 0).toFixed(2)}</td>
                <td>{r.pdf_path? <span className="tiny mono">{r.pdf_path}</span> : <span className="tiny">—</span>}</td>
                <td style={{textAlign:'right'}}>
                  <div className="btn-row" style={{justifyContent:'flex-end'}}>
                    <button className="btn btn-outline-primary" onClick={()=>setEditId(r.id)}>Edit</button>
                    <button className="btn" onClick={()=>generatePdf(r)}><i className="fa-regular fa-file-pdf"/> PDF</button>
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

      {editId? <InvoiceEditor invoiceId={editId} onClose={onSaved}/> : null}

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

function fmtDate(s){
  try{ return new Date(s).toLocaleString(); }catch{ return s||''; }
}

function renderInvoiceHtml({row, settings}){
  const total=(row.totals?.grandTotal ?? row.totals?.totalAfterTax ?? 0).toFixed(2);
  const preTax=(row.totals?.totalChargePreTax ?? 0).toFixed(2);
  const tax=(row.totals?.tax ?? 0).toFixed(2);
  const dep=(row.deposit ?? 0).toFixed(2);
  const due=(row.totals?.totalDue ?? total).toFixed(2);

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
        <div class="mono"># ${escapeHtml(row.code)}</div>
        <div style="font-size:12px; color:#555">${new Date(row.created_at).toLocaleDateString()}</div>
      </div>
    </div>

    <div style="margin:18px 0; height:1px; background:#eee;"></div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div class="card" style="padding:12px;">
        <div style="font-size:12px; color:#666;">Memo</div>
        <div style="white-space:pre-wrap; font-size:14px;">${escapeHtml(row.memo||'')}</div>
      </div>
      <div class="card" style="padding:12px;">
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Pre-tax</span><b>$${preTax}</b></div>
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Tax</span><b>$${tax}</b></div>
        <div style="display:flex; justify-content:space-between; margin:4px 0;"><span>Deposit</span><b>-$${dep}</b></div>
        <div style="display:flex; justify-content:space-between; margin:8px 0; font-size:18px;"><span>Total</span><b>$${total}</b></div>
        <div style="display:flex; justify-content:space-between; margin:8px 0; font-size:18px;"><span>Amount Due</span><b>$${due}</b></div>
      </div>
    </div>
  </div>`;
}

function renderEmailHtml({row, settings}){
  const total=(row.totals?.grandTotal ?? row.totals?.totalAfterTax ?? 0).toFixed(2);
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
