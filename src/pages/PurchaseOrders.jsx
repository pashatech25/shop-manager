import {useEffect, useMemo, useRef, useState} from 'react';
import {useTenant} from '../context/TenantContext.jsx';
import {fetchLowItemsGrouped, fetchVendorsMap, createPOWithItems, listPOs, listPOItems, markPOSent, receivePO, savePOPdfPath} from '../features/purchasing/api.js';
import Spinner from '../features/ui/Spinner.jsx';
import Confirm from '../features/ui/Confirm.jsx';
import {captureElementToPdf} from '../features/pdf/service.js';
import {supabase} from '../lib/superbase.js';

export default function PurchaseOrders(){
  const {tenantId}=useTenant();
  const [loading,setLoading]=useState(true);
  const [lowByVendor,setLowByVendor]=useState({});
  const [vendors,setVendors]=useState({});
  const [pos,setPOs]=useState([]);
  const [viewPO,setViewPO]=useState(null);
  const [poItems,setPOItems]=useState([]);
  const [emailFor,setEmailFor]=useState(null);
  const printRef=useRef(null);

  const load=async ()=>{
    if(!tenantId) return;
    setLoading(true);
    const [low, vm, pl]=await Promise.all([
      fetchLowItemsGrouped(tenantId),
      fetchVendorsMap(tenantId),
      listPOs(tenantId)
    ]);
    setLowByVendor(low); setVendors(vm); setPOs(pl); setLoading(false);
  };

  useEffect(()=>{ load(); },[tenantId]);

  const createForVendor=async (vendorId)=>{
    const vendor=vendors[vendorId];
    const items=(lowByVendor[vendorId]||[]).map((m)=>{
      const need = Math.max(0, Number(m.reorder_threshold||0) - (Number(m.on_hand||0) - Number(m.reserved||0)));
      return {
        material_id: m.id,
        description: m.name,
        qty: need || 1,
        unit_cost: m.purchase_price ?? null
      };
    });
    const po=await createPOWithItems({tenantId, vendor, items});
    alert(`PO created: ${po.code}`);
    await load();
  };

  const openPO=async (po)=>{
    setViewPO(po);
    const items=await listPOItems(tenantId, po.id);
    setPOItems(items);
  };

  const doReceive=async (po)=>{
    if(!confirm('Mark as received and update inventory?')) return;
    await receivePO(po.id);
    alert('PO received and inventory updated.');
    await load();
  };

  const generatePdf=async (po)=>{
    const el=printRef.current;
    if(!el){ alert('Printable element not found'); return; }
    el.innerHTML = renderPOHtml({po, vendor: vendors[po.vendor_id]||{}, items: poItems});
    const {url}=await captureElementToPdf({element: el, tenantId, kind:'purchase-orders', code:po.code});
    await savePOPdfPath(po.id, `${tenantId}/purchase-orders/${po.code}.pdf`);
    alert('PO PDF saved.\n'+url);
    await load();
  };

  const sendEmail=async (po, to)=>{
    const vendor=vendors[po.vendor_id]||{};
    const subject=`Purchase Order ${po.code}`;
    const html=renderPOEmail({po, vendor});
    const {error}=await supabase.functions.invoke('email-doc',{body:{to, subject, html}});
    if(error){ alert(error.message); return; }
    alert('Email sent.');
    setEmailFor(null);
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Purchase Orders</h2>
        {loading? <Spinner label="Loading"/> : null}
      </div>

      <div className="card">
        <h3 className="tiny">Low Inventory by Vendor</h3>
        {Object.keys(lowByVendor).length===0? <div className="tiny">No low items.</div> : null}
        <div className="cards">
          {Object.entries(lowByVendor).map(([vendorId, items])=>{
            const v=vendors[vendorId]||{name:'(Unknown)'};
            return (
              <div key={vendorId} className="card">
                <div className="row">
                  <b>{v.name}</b>
                  <button className="btn btn-primary" onClick={()=>createForVendor(vendorId)}>Create PO</button>
                </div>
                <ul style={{margin:'8px 0 0 18px'}}>
                  {items.map((m)=>(
                    <li key={m.id}>
                      {m.name} <span className="tiny">on hand {m.on_hand ?? 0}, reserved {m.reserved ?? 0}, threshold {m.reorder_threshold ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      <div className="table-wrap" style={{marginTop:20}}>
        <table className="table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>PDF</th>
              <th style={{textAlign:'right'}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(pos||[]).map((po)=>(
              <tr key={po.id}>
                <td className="mono">{po.code}</td>
                <td>{vendors[po.vendor_id]?.name || '—'}</td>
                <td><span className="badge">{po.status}</span></td>
                <td>{po.pdf_path? <span className="tiny mono">{po.pdf_path}</span> : <span className="tiny">—</span>}</td>
                <td style={{textAlign:'right'}}>
                  <div className="btn-row" style={{justifyContent:'flex-end'}}>
                    <button className="btn" onClick={()=>openPO(po)}>View</button>
                    {po.status==='open'? <button className="btn" onClick={()=>markPOSent(po.id).then(load)}>Mark Sent</button> : null}
                    {po.status!=='received'? <button className="btn btn-primary" onClick={()=>doReceive(po)}>Receive</button> : null}
                    <button className="btn" onClick={()=>openPO(po)}><i className="fa-regular fa-file-pdf"/> PDF</button>
                    <button className="btn" onClick={()=>setEmailFor(po)}><i className="fa-regular fa-envelope"/> Email</button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && pos.length===0? <tr><td colSpan={5} className="tiny">No POs yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {viewPO? <POModal po={viewPO} onClose={()=>setViewPO(null)} onReady={(items)=>setPOItems(items)} onPdf={()=>generatePdf(viewPO)}/> : null}

      <div ref={printRef} style={{position:'fixed', left:-9999, top:-9999}}/>

      <Confirm
        open={!!emailFor}
        title={`Email ${emailFor?.code}`}
        message={(
          <span>
            <label className="tiny">Recipient</label>
            <input id="pomail" type="email" placeholder="name@vendor.com" style={{width:'100%'}} defaultValue="" />
          </span>
        )}
        onYes={()=>{
          const to=document.getElementById('pomail')?.value?.trim();
          if(!to) return alert('Enter an email');
          sendEmail(emailFor, to);
        }}
        onNo={()=>setEmailFor(null)}
      />
    </section>
  );
}

function POModal({po, onClose, onReady, onPdf}){
  const {tenantId}=useTenant();
  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async ()=>{
      setLoading(true);
      const rows=await listPOItems(tenantId, po.id);
      setItems(rows); setLoading(false);
      onReady?.(rows);
    };
    load();
  },[tenantId, po.id]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3>PO <span className="tiny mono">{po.code}</span></h3>
          <div className="btn-row">
            <button className="btn" onClick={onPdf}><i className="fa-regular fa-file-pdf"/> PDF</button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
        {loading? <Spinner label="Loading items"/> :
          <table className="table" style={{marginTop:10}}>
            <thead><tr><th>Description</th><th>Qty</th><th>Unit Cost</th></tr></thead>
            <tbody>
              {items.map((it)=>(
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td>{it.qty}</td>
                  <td>{it.unit_cost!=null? `$${Number(it.unit_cost).toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>
    </div>
  );
}

function renderPOHtml({po, vendor, items}){
  return `
  <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
    <div style="display:flex; justify-content:space-between;">
      <div><h2 style="margin:0 0 6px 0;">Purchase Order</h2><div class="mono"># ${po.code}</div></div>
      <div style="text-align:right">
        <div style="font-size:14px">${vendor.name || ''}</div>
        <div style="font-size:12px; color:#555">${vendor.email || ''}</div>
      </div>
    </div>
    <div style="margin:12px 0; height:1px; background:#eee;"></div>
    <table style="width:100%; border-collapse:collapse; font-size:14px">
      <thead><tr><th style="text-align:left; padding:6px 4px;">Description</th><th style="text-align:right; padding:6px 4px;">Qty</th><th style="text-align:right; padding:6px 4px;">Unit</th></tr></thead>
      <tbody>
        ${(items||[]).map((it)=>`
          <tr>
            <td style="border-bottom:1px solid #eee; padding:6px 4px;">${escape(it.description)}</td>
            <td style="border-bottom:1px solid #eee; padding:6px 4px; text-align:right;">${Number(it.qty||0)}</td>
            <td style="border-bottom:1px solid #eee; padding:6px 4px; text-align:right;">${it.unit_cost!=null? '$'+Number(it.unit_cost).toFixed(2) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function renderPOEmail({po, vendor}){
  return `
    <div style="font-family:Arial; color:#111">
      <p>Hello ${escape(vendor.name||'')},</p>
      <p>Please see Purchase Order <b>${escape(po.code)}</b>.</p>
      <p>Thank you.</p>
    </div>
  `;
}

function escape(s){ return String(s||'').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
