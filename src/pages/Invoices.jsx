import {useEffect, useRef, useState} from "react";
import {useTenant} from "../context/TenantContext.jsx";
import {supabase} from "../lib/superbase.js";
import Editor from "../features/invoices/Editor.jsx";
import {captureElementToPdf} from "../features/pdf/service.js";

// --- shared helpers (same math as Editor) ---
async function loadPriceMaps(tenantId){
  const [mats, equips] = await Promise.all([
    supabase.from("materials").select("id,selling_price").eq("tenant_id", tenantId),
    supabase.from("equipments").select("id,rate_c,rate_m,rate_y,rate_k,rate_white,rate_soft_white,rate_gloss").eq("tenant_id", tenantId)
  ]);
  const matMap = new Map((mats.data||[]).map(r=>[r.id, Number(r.selling_price||0)]));
  const eqMap  = new Map((equips.data||[]).map(r=>[r.id, {
    c:+(r.rate_c||0), m:+(r.rate_m||0), y:+(r.rate_y||0), k:+(r.rate_k||0),
    white:+(r.rate_white||0), soft_white:+(r.rate_soft_white||0), gloss:+(r.rate_gloss||0)
  }]));
  return {matMap, eqMap};
}
function recomputeChargesFromItems(items, {matMap, eqMap}, marginPct=100){
  const mats=Array.isArray(items?.materials)?items.materials:[];
  const eqs =Array.isArray(items?.equipments)?items.equipments:[];
  const adds=Array.isArray(items?.addons)?items.addons:[];
  const labs=Array.isArray(items?.labor)?items.labor:[];
  let materialsCharge=0; for(const l of mats){ materialsCharge += Number(l.qty||0) * (matMap.get(l.material_id)||0); }
  let equipmentCharge=0, uvInkCost=0;
  for(const l of eqs){
    const type=(l.type||"").toLowerCase();
    const isUV= type.includes("uv") || type.includes("sublimation");
    if(!isUV){
      if(l.mode==="hourly") equipmentCharge += Number(l.hours||0)*Number(l.rate||0);
      else equipmentCharge += Number(l.flat_fee||0);
      continue;
    }
    const r=eqMap.get(l.equipment_id)||{};
    const ink=l.inks||{}; const sw=!!l.use_soft_white;
    uvInkCost += Number(ink.c||0)*(r.c||0)
               + Number(ink.m||0)*(r.m||0)
               + Number(ink.y||0)*(r.y||0)
               + Number(ink.k||0)*(r.k||0)
               + Number(ink.gloss||0)*(r.gloss||0)
               + (sw? Number(ink.soft_white||0)*(r.soft_white||0) : Number(ink.white||0)*(r.white||0));
  }
  const inkCharge= uvInkCost * (1 + Number(marginPct||0)/100);
  let laborCharge=0; for(const l of labs){ laborCharge += Number(l.hours||0)*Number(l.rate||0); }
  let addonsCharge=0; for(const a of adds){ addonsCharge += Number(a.qty||0)*Number(a.price||0); }
  const preTax = equipmentCharge + materialsCharge + laborCharge + addonsCharge + (isFinite(inkCharge)? inkCharge:0);
  return {equipmentCharge, materialsCharge, laborCharge, addonsCharge, inkCharge, preTax};
}
function calcTotalsView(r, taxRatePct){
  const t=r?.totals||{};
  const pre=Number(t.totalChargePreTax||0);
  const disc=Number(r?.discount||0);
  const discAmt=(r?.discount_type==="percent")? (pre*(disc/100)) : disc;
  const taxableBase = (t?.discountApplyTax? Math.max(0, pre-discAmt) : pre);
  const tax = taxableBase * (Number(taxRatePct||0)/100);
  const dep = Number(r?.deposit||0);
  const grand = Math.max(0, (pre - discAmt) + tax - dep);
  return {pre, discAmt, tax, dep, grand};
}

export default function Invoices(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [editing,setEditing]=useState(null);
  const [viewRow,setViewRow]=useState(null);
  const [viewCustomer,setViewCustomer]=useState(null);
  const [settings,setSettings]=useState(null);
  const printRef=useRef(null);

  const load=async ()=>{
    if(!tenantId) return;
    const {data}=await supabase.from("invoices").select("*").eq("tenant_id", tenantId).order("created_at",{ascending:false});
    setRows(data||[]);
    const {data:st}=await supabase.from("settings").select("tax_rate,currency").eq("tenant_id", tenantId).maybeSingle();
    setSettings(st||{tax_rate:0,currency:"USD"});
  };
  useEffect(()=>{ load(); },[tenantId]);

  const openView=async (row)=>{
    setViewRow(null); setViewCustomer(null);
    const [custRes, maps] = await Promise.all([
      row?.customer_id
        ? supabase.from("customers").select("id,company,name,email,phone,address,website").eq("id", row.customer_id).maybeSingle()
        : Promise.resolve({data:null}),
      loadPriceMaps(tenantId)
    ]);
    const marginPct=row?.items?.meta?.marginPct ?? 100;
    const f=recomputeChargesFromItems(row?.items, maps, marginPct);
    setViewCustomer(custRes.data||null);
    setViewRow({
      ...row,
      totals:{
        ...(row?.totals||{}),
        equipmentCharge: row?.totals?.equipmentCharge ?? f.equipmentCharge,
        materialsCharge: row?.totals?.materialsCharge ?? f.materialsCharge,
        laborCharge:     row?.totals?.laborCharge     ?? f.laborCharge,
        addonsCharge:    row?.totals?.addonsCharge    ?? f.addonsCharge,
        inkCharge:       row?.totals?.inkCharge       ?? f.inkCharge,
        totalChargePreTax: row?.totals?.totalChargePreTax ?? f.preTax
      }
    });
  };

  const generatePdf=async (r)=>{
    if(!printRef.current) return;
    const t=r?.totals||{};
    const showInk = !!(t.showInkUsage);
    const {pre, discAmt, tax, dep, grand}=calcTotalsView(r, settings?.tax_rate);
    const html = `
      <div style="font-family:Arial;padding:24px;width:800px">
        <h2 style="margin:0 0 6px 0">Invoice <span style="font-weight:normal">#${r.code}</span></h2>
        <div style="margin:8px 0 16px 0; font-size:12px; color:#555">Date: ${new Date(r.created_at).toLocaleString()}</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tbody>
            <tr><td>Equipment</td><td style="text-align:right">$${Number(t.equipmentCharge||0).toFixed(2)}</td></tr>
            <tr><td>Materials</td><td style="text-align:right">$${Number(t.materialsCharge||0).toFixed(2)}</td></tr>
            <tr><td>Labor</td><td style="text-align:right">$${Number(t.laborCharge||0).toFixed(2)}</td></tr>
            <tr><td>Add-ons</td><td style="text-align:right">$${Number(t.addonsCharge||0).toFixed(2)}</td></tr>
            ${showInk? `<tr><td>UV/Sublimation Ink (margin applied)</td><td style="text-align:right">$${Number(t.inkCharge||0).toFixed(2)}</td></tr>`:""}
            <tr><td><b>Subtotal</b></td><td style="text-align:right"><b>$${pre.toFixed(2)}</b></td></tr>
            <tr><td>Discount</td><td style="text-align:right">−$${discAmt.toFixed(2)}</td></tr>
            <tr><td>Tax (${Number(settings?.tax_rate||0).toFixed(2)}%)</td><td style="text-align:right">$${tax.toFixed(2)}</td></tr>
            <tr><td>Deposit</td><td style="text-align:right">−$${dep.toFixed(2)}</td></tr>
            <tr><td><b>Total</b></td><td style="text-align:right"><b>$${grand.toFixed(2)}</b></td></tr>
          </tbody>
        </table>
      </div>`;
    printRef.current.innerHTML = html;
    const {url}=await captureElementToPdf({element: printRef.current, tenantId, kind:"invoices", code:r.code});
    alert("PDF saved: "+url);
  };

  const emailInvoice = async (r)=>{
    const to = prompt("Send invoice to (email):");
    if(!to) return;
    const subject = `Invoice ${r.code}`;
    const t=r?.totals||{};
    const showInk = !!t.showInkUsage;
    const {pre, discAmt, tax, dep, grand}=calcTotalsView(r, settings?.tax_rate);
    const html = `
      <div style="font-family:Arial; color:#111">
        <p>Please find invoice <b>${r.code}</b> below.</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tbody>
            <tr><td>Equipment</td><td style="text-align:right">$${Number(t.equipmentCharge||0).toFixed(2)}</td></tr>
            <tr><td>Materials</td><td style="text-align:right">$${Number(t.materialsCharge||0).toFixed(2)}</td></tr>
            <tr><td>Labor</td><td style="text-align:right">$${Number(t.laborCharge||0).toFixed(2)}</td></tr>
            <tr><td>Add-ons</td><td style="text-align:right">$${Number(t.addonsCharge||0).toFixed(2)}</td></tr>
            ${showInk? `<tr><td>UV/Sublimation Ink</td><td style="text-align:right">$${Number(t.inkCharge||0).toFixed(2)}</td></tr>`:""}
            <tr><td>Subtotal</td><td style="text-align:right">$${pre.toFixed(2)}</td></tr>
            <tr><td>Discount</td><td style="text-align:right">−$${discAmt.toFixed(2)}</td></tr>
            <tr><td>Tax (${Number(settings?.tax_rate||0).toFixed(2)}%)</td><td style="text-align:right">$${tax.toFixed(2)}</td></tr>
            <tr><td>Deposit</td><td style="text-align:right">−$${dep.toFixed(2)}</td></tr>
            <tr><td><b>Total</b></td><td style="text-align:right"><b>$${grand.toFixed(2)}</b></td></tr>
          </tbody>
        </table>
        <p>Thank you.</p>
      </div>`;
    const {error}=await supabase.functions.invoke('email-doc',{body:{to, subject, html}});
    if(error){ alert(error.message); return; }
    alert('Email sent.');
  };

  // simple row calc (no hooks)
  const rowCalc = (r)=>{
    const t=r?.totals||{};
    const pre = Number(t.totalChargePreTax ?? (
      Number(t.equipmentCharge||0)
      + Number(t.materialsCharge||0)
      + Number(t.laborCharge||0)
      + Number(t.addonsCharge||0)
      + Number(t.inkCharge||0)
    ));
    const disc=Number(r?.discount||0);
    const discAmt=(r?.discount_type==="percent")? (pre*(disc/100)) : disc;
    const taxableBase = (t?.discountApplyTax? Math.max(0, pre-discAmt) : pre);
    const tax = taxableBase * (Number(settings?.tax_rate||0)/100);
    const dep = Number(r?.deposit||0);
    const grand = Math.max(0, (pre - discAmt) + tax - dep);
    return {pre, grand};
  };

  return (
    <section className="section">
      <div className="section-header"><h2>Invoices</h2></div>

      {editing? (
        <div className="card">
          <Editor
            row={editing}
            onClose={()=>setEditing(null)}
            onSaved={(up)=>{
              setEditing(null);
              setRows((xs)=>xs.map((r)=>r.id===up.id? up:r));
            }}
          />
        </div>
      ):null}

      {viewRow? (
        <div className="modal" onClick={()=>setViewRow(null)}>
          <div className="modal-content" onClick={(e)=>e.stopPropagation()}>
            <div className="row">
              <h3>Invoice <span className="tiny mono">#{viewRow.code}</span></h3>
              <div className="btn-row">
                <button className="btn" onClick={()=>generatePdf(viewRow)}><i className="fa-regular fa-file-pdf"/> PDF</button>
                <button className="btn" onClick={()=>emailInvoice(viewRow)}><i className="fa-regular fa-envelope"/> Email</button>
                <button className="btn btn-secondary" onClick={()=>setViewRow(null)}>Close</button>
              </div>
            </div>
            <div className="tiny">Created: {new Date(viewRow.created_at).toLocaleString()}</div>

            {viewCustomer? (
              <div className="card" style={{marginTop:10}}>
                <b>Customer</b>
                <div className="tiny">{viewCustomer.company||viewCustomer.name}</div>
                <div className="tiny">{viewCustomer.email}</div>
                <div className="tiny">{viewCustomer.phone}</div>
                <div className="tiny">{viewCustomer.address}</div>
              </div>
            ):null}

            {/* Charges box – no hooks here */}
            {(() =>{
              const t=viewRow?.totals||{};
              const showInk = !!t.showInkUsage;
              const c = calcTotalsView(viewRow, settings?.tax_rate);
              return (
                <div className="card" style={{marginTop:10}}>
                  <b>Charges</b>
                  <div className="tiny">Equipment: ${Number(t.equipmentCharge||0).toFixed(2)}</div>
                  <div className="tiny">Materials: ${Number(t.materialsCharge||0).toFixed(2)}</div>
                  <div className="tiny">Labor: ${Number(t.laborCharge||0).toFixed(2)}</div>
                  <div className="tiny">Add-ons: ${Number(t.addonsCharge||0).toFixed(2)}</div>
                  {showInk? <div className="tiny">UV/Sublimation Ink: ${Number(t.inkCharge||0).toFixed(2)}</div> : null}
                  <div className="tiny"><b>Subtotal</b>: ${c.pre.toFixed(2)}</div>
                  <div className="tiny">Discount: −${c.discAmt.toFixed(2)}</div>
                  <div className="tiny">Tax ({Number(settings?.tax_rate||0).toFixed(2)}%): ${c.tax.toFixed(2)}</div>
                  <div className="tiny">Deposit: −${c.dep.toFixed(2)}</div>
                  <div className="tiny"><b>Total</b>: ${c.grand.toFixed(2)}</div>
                </div>
              );
            })()}
          </div>
        </div>
      ):null}

      {/* Back to your table list */}
      <div className="table-wrap" style={{marginTop:16}}>
        <table className="table">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Title</th>
              <th>Date</th>
              <th style={{textAlign:"right"}}>Subtotal</th>
              <th style={{textAlign:"right"}}>Total</th>
              <th style={{textAlign:"right"}}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows||[]).map((r)=>{
              const c=rowCalc(r);
              return (
                <tr key={r.id}>
                  <td className="mono">{r.code}</td>
                  <td>{r.title||"—"}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={{textAlign:"right"}}>${c.pre.toFixed(2)}</td>
                  <td style={{textAlign:"right"}}>${c.grand.toFixed(2)}</td>
                  <td style={{textAlign:"right"}}>
                    <div className="btn-row" style={{justifyContent:"flex-end"}}>
                      <button className="btn" onClick={()=>openView(r)}>View</button>
                      <button className="btn" onClick={()=>setEditing(r)}>Edit</button>
                      <button className="btn" onClick={()=>generatePdf(r)}><i className="fa-regular fa-file-pdf"/> PDF</button>
                      <button className="btn" onClick={()=>emailInvoice(r)}><i className="fa-regular fa-envelope"/> Email</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length===0? <tr><td colSpan={6} className="tiny">No invoices yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <div ref={printRef} style={{position:"fixed", left:-9999, top:-9999}}/>
    </section>
  );
}
