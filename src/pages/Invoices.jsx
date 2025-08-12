import {useEffect, useRef, useState} from "react";
import {useTenant} from "../context/TenantContext.jsx";
import {supabase} from "../lib/superbase.js";
import Editor from "../features/invoices/Editor.jsx";
import {captureElementToPdf} from "../features/pdf/service.js";
import Confirm from "../features/ui/Confirm.jsx";

/* ---------------- helpers ---------------- */
const num = (v, d=0)=> {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

async function loadPriceMaps(tenantId){
  const [mats, equips] = await Promise.all([
    supabase.from("materials")
      .select("id,selling_price")
      .eq("tenant_id", tenantId),
    supabase.from("equipments")
      .select("id,rate_c,rate_m,rate_y,rate_k,rate_white,rate_soft_white,rate_gloss")
      .eq("tenant_id", tenantId)
  ]);
  const matMap = new Map((mats.data||[]).map(r=>[r.id, num(r.selling_price)]));
  const eqMap  = new Map((equips.data||[]).map(r=>[r.id, {
    c:num(r.rate_c), m:num(r.rate_m), y:num(r.rate_y), k:num(r.rate_k),
    white:num(r.rate_white), soft_white:num(r.rate_soft_white), gloss:num(r.rate_gloss)
  }]));
  return {matMap, eqMap};
}

/** Recompute charges from the invoice's items, independent of stale totals */
function recomputeChargesFromItems(items, {matMap, eqMap}, marginPct=100){
  const mats = Array.isArray(items?.materials)? items.materials : [];
  const eqs  = Array.isArray(items?.equipments)? items.equipments : [];
  const adds = Array.isArray(items?.addons)? items.addons : [];
  const labs = Array.isArray(items?.labor)? items.labor : [];

  // Materials charge from selling price
  let materialsCharge=0;
  for(const l of mats){
    materialsCharge += num(l.qty)*num(matMap.get(l.material_id));
  }

  // Equipment & UV/Sublimation ink
  let equipmentCharge=0, uvInkCost=0;
  for(const l of eqs){
    const type=(l.type||"").toLowerCase();
    const isUV = type.includes("uv") || type.includes("sublimation");
    if(!isUV){
      equipmentCharge += (l.mode==="hourly")
        ? num(l.hours)*num(l.rate)
        : num(l.flat_fee);
      continue;
    }
    const r = eqMap.get(l.equipment_id)||{};
    const ink=l.inks||{}; const sw=!!l.use_soft_white;
    uvInkCost += num(ink.c)*num(r.c)
               + num(ink.m)*num(r.m)
               + num(ink.y)*num(r.y)
               + num(ink.k)*num(r.k)
               + num(ink.gloss)*num(r.gloss)
               + (sw? num(ink.soft_white)*num(r.soft_white) : num(ink.white)*num(r.white));
  }

  const margin = 1 + (num(marginPct)/100);
  const inkCharge = uvInkCost * margin;

  // Labor / Add-ons
  let laborCharge=0;   for(const l of labs){ laborCharge += num(l.hours)*num(l.rate); }
  let addonsCharge=0;  for(const a of adds){ addonsCharge += num(a.qty)*num(a.price); }

  const preTax = equipmentCharge + materialsCharge + laborCharge + addonsCharge + inkCharge;
  return {equipmentCharge, materialsCharge, laborCharge, addonsCharge, inkCharge, preTax};
}

/** Read discount/deposit/showInk robustly across your schema */
function extractDiscountModel(row){
  const t = row?.totals || {};

  let type = row?.discount_type ?? t?.discountType ?? null;

  let value =
    row?.discount ??
    row?.discount_value ??
    row?.discount_amount ??
    t?.discountValue ??
    t?.discountAmount ??
    t?.discount;

  if(!type){
    if(row?.discount_percent != null || t?.discountPercent != null) type = "percent";
    else type = "flat";
  }

  if(value == null){
    if(type === "percent"){
      value = row?.discount_percent ?? t?.discountPercent ?? 0;
    }else{
      value = 0;
    }
  }

  return {
    type: (type === "percent" ? "percent" : "flat"),
    value: num(value, 0),
    applyTax: !!(row?.discount_apply_tax ?? t?.discountApplyTax),
    deposit: num(row?.deposit ?? t?.deposit, 0),
    showInk: !!(row?.show_ink_usage ?? t?.showInkUsage),
  };
}

/** ✅ Correct discount math for both modes */
function computeBill(preTax, {type, value, applyTax, deposit}, taxRatePct){
  const discountAmt = (type==="percent") ? (preTax * (num(value)/100)) : num(value);

  if (applyTax) {
    // discount BEFORE tax
    const base = Math.max(0, preTax - discountAmt);
    const tax  = base * (num(taxRatePct)/100);
    const grand = Math.max(0, base + tax - num(deposit));
    return {discountAmt, tax, grand};
  } else {
    // discount AFTER tax
    const tax  = preTax * (num(taxRatePct)/100);
    const subtotalAfterTax = preTax + tax;
    const grand = Math.max(0, subtotalAfterTax - discountAmt - num(deposit));
    return {discountAmt, tax, grand};
  }
}

/* ---------------- component ---------------- */
export default function Invoices(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [editing,setEditing]=useState(null);

  const [viewRow,setViewRow]=useState(null);
  const [viewCustomer,setViewCustomer]=useState(null);
  const [settings,setSettings]=useState(null);

  // Email + PDF preview
  const [emailFor, setEmailFor] = useState(null);
  const [emailDefault, setEmailDefault] = useState(""); // <-- prefill here
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const printRef=useRef(null);

  const load=async ()=>{
    if(!tenantId) return;
    const {data}=await supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at",{ascending:false});
    setRows(data||[]);
    const {data:st}=await supabase
      .from("settings")
      .select("tax_rate,currency")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    setSettings(st||{tax_rate:0,currency:"USD"});
  };
  useEffect(()=>{ load(); },[tenantId]);

  /* ---------- VIEW ---------- */
  const openView=async (row)=>{
    setViewRow(null); setViewCustomer(null);
    const [custRes, maps] = await Promise.all([
      row?.customer_id
        ? supabase.from("customers").select("id,company,name,email,phone,address,website").eq("id", row.customer_id).maybeSingle()
        : Promise.resolve({data:null}),
      loadPriceMaps(tenantId)
    ]);

    const marginPct = row?.items?.meta?.marginPct ?? 100;
    const charges = recomputeChargesFromItems(row?.items, maps, marginPct);
    const disc = extractDiscountModel(row);

    const t = row?.totals || {};
    const preTax = num(charges.preTax,
      num(t.totalChargePreTax,
        num(t.equipmentCharge)+num(t.materialsCharge)+num(t.laborCharge)+num(t.addonsCharge)+num(t.inkCharge)
      )
    );

    const totals = {
      equipmentCharge: charges.equipmentCharge,
      materialsCharge: charges.materialsCharge,
      laborCharge:     charges.laborCharge,
      addonsCharge:    charges.addonsCharge,
      inkCharge:       charges.inkCharge,
      totalChargePreTax: preTax,
      showInkUsage:    disc.showInk
    };

    setViewCustomer(custRes.data||null);
    setViewRow({...row, totals});
  };

  /* ---------- PDF ---------- */
  const generatePdf=async (r)=>{
    if(!printRef.current) return;
    const {matMap, eqMap} = await loadPriceMaps(tenantId);
    const marginPct = r?.items?.meta?.marginPct ?? 100;
    const charges = recomputeChargesFromItems(r?.items, {matMap, eqMap}, marginPct);
    const disc = extractDiscountModel(r);
    const bill = computeBill(charges.preTax, disc, settings?.tax_rate);

    const html = `
      <div style="font-family:Arial;padding:24px;width:800px">
        <h2 style="margin:0 0 6px 0">Invoice <span style="font-weight:normal">#${r.code}</span></h2>
        <div style="margin:8px 0 16px 0; font-size:12px; color:#555">Date: ${new Date(r.created_at).toLocaleString()}</div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tbody>
            <tr><td>Equipment</td><td style="text-align:right">$${num(charges.equipmentCharge).toFixed(2)}</td></tr>
            <tr><td>Materials</td><td style="text-align:right">$${num(charges.materialsCharge).toFixed(2)}</td></tr>
            <tr><td>Labor</td><td style="text-align:right">$${num(charges.laborCharge).toFixed(2)}</td></tr>
            <tr><td>Add-ons</td><td style="text-align:right">$${num(charges.addonsCharge).toFixed(2)}</td></tr>
            ${disc.showInk ? `<tr><td>UV/Sublimation Ink (margin applied)</td><td style="text-align:right">$${num(charges.inkCharge).toFixed(2)}</td></tr>` : ""}
            <tr><td><b>Subtotal</b></td><td style="text-align:right"><b>$${num(charges.preTax).toFixed(2)}</b></td></tr>
            <tr><td>Discount</td><td style="text-align:right">−$${num(bill.discountAmt).toFixed(2)}</td></tr>
            <tr><td>Tax (${num(settings?.tax_rate).toFixed(2)}%)</td><td style="text-align:right">$${num(bill.tax).toFixed(2)}</td></tr>
            <tr><td>Deposit</td><td style="text-align:right">−$${num(disc.deposit).toFixed(2)}</td></tr>
            <tr><td><b>Total</b></td><td style="text-align:right"><b>$${num(bill.grand).toFixed(2)}</b></td></tr>
          </tbody>
        </table>
      </div>`;
    printRef.current.innerHTML = html;

    const {url}=await captureElementToPdf({element: printRef.current, tenantId, kind:"invoices", code:r.code});
    setPdfUrl(url);
    setPdfOpen(true);
  };

  /* ---------- Email: open modal prefilled with customer email ---------- */
  const openEmail = async (r)=>{
    setEmailDefault("");
    try{
      let def = "";
      if(r?.customer_id){
        const {data} = await supabase
          .from("customers")
          .select("email")
          .eq("id", r.customer_id)
          .maybeSingle();
        def = data?.email || "";
      }
      setEmailDefault(def);
    }catch(e){
      // ignore; keep empty fallback
    }
    setEmailFor(r);
  };

  const emailInvoice = async (r, to)=>{
    try{
      const {matMap, eqMap} = await loadPriceMaps(tenantId);
      const marginPct = r?.items?.meta?.marginPct ?? 100;
      const charges = recomputeChargesFromItems(r?.items, {matMap, eqMap}, marginPct);
      const disc = extractDiscountModel(r);
      const bill = computeBill(charges.preTax, disc, settings?.tax_rate);

      const html = `
        <div style="font-family:Arial; color:#111">
          <p>Please find invoice <b>${r.code}</b> below.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tbody>
              <tr><td>Equipment</td><td style="text-align:right">$${num(charges.equipmentCharge).toFixed(2)}</td></tr>
              <tr><td>Materials</td><td style="text-align:right">$${num(charges.materialsCharge).toFixed(2)}</td></tr>
              <tr><td>Labor</td><td style="text-align:right">$${num(charges.laborCharge).toFixed(2)}</td></tr>
              <tr><td>Add-ons</td><td style="text-align:right">$${num(charges.addonsCharge).toFixed(2)}</td></tr>
              ${disc.showInk? `<tr><td>UV/Sublimation Ink (margin applied)</td><td style="text-align:right">$${num(charges.inkCharge).toFixed(2)}</td></tr>`:""}
              <tr><td>Subtotal</td><td style="text-align:right">$${num(charges.preTax).toFixed(2)}</td></tr>
              <tr><td>Discount</td><td style="text-align:right">−$${num(bill.discountAmt).toFixed(2)}</td></tr>
              <tr><td>Tax (${num(settings?.tax_rate).toFixed(2)}%)</td><td style="text-align:right">$${num(bill.tax).toFixed(2)}</td></tr>
              <tr><td>Deposit</td><td style="text-align:right">−$${num(disc.deposit).toFixed(2)}</td></tr>
              <tr><td><b>Total</b></td><td style="text-align:right"><b>$${num(bill.grand).toFixed(2)}</b></td></tr>
            </tbody>
          </table>
          <p>Thank you.</p>
        </div>`;

      let attachments;
      const guess = `${tenantId}/invoices/${r.code}.pdf`;
      const { data:sign } = await supabase.storage.from("pdfs").createSignedUrl(guess, 3600);
      if(sign?.signedUrl){ attachments = [{ filename: `${r.code}.pdf`, url: sign.signedUrl }]; }

      const {error}=await supabase.functions.invoke('email-doc',{body:{to, subject:`Invoice ${r.code}`, html, attachments}});
      if(error) throw error;
      alert('Email sent.');
      setEmailFor(null);
      setEmailDefault("");
    }catch(ex){
      console.error(ex);
      alert(ex.message || "Failed to send email");
    }
  };

  /* ---------- list row calc (for table totals) ---------- */
  const rowCalc = (r)=>{
    const t=r?.totals||{};
    const recomputedPre = num(t.totalChargePreTax,
      num(t.equipmentCharge)+num(t.materialsCharge)+num(t.laborCharge)+num(t.addonsCharge)+num(t.inkCharge)
    );
    const disc = extractDiscountModel(r);
    const {discountAmt, tax, grand} = computeBill(recomputedPre, disc, settings?.tax_rate);
    return {pre: recomputedPre, discountAmt, tax, grand};
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
                <button className="btn" onClick={()=>openEmail(viewRow)}><i className="fa-regular fa-envelope"/> Email</button>
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

            {(()=>{
              const t=viewRow?.totals||{};
              const disc = extractDiscountModel(viewRow);
              const {discountAmt, tax, grand} = computeBill(num(t.totalChargePreTax), disc, settings?.tax_rate);
              return (
                <div className="card" style={{marginTop:10}}>
                  <b>Charges</b>
                  <div className="tiny">Equipment: ${num(t.equipmentCharge).toFixed(2)}</div>
                  <div className="tiny">Materials: ${num(t.materialsCharge).toFixed(2)}</div>
                  <div className="tiny">Labor: ${num(t.laborCharge).toFixed(2)}</div>
                  <div className="tiny">Add-ons: ${num(t.addonsCharge).toFixed(2)}</div>
                  {disc.showInk? <div className="tiny">UV/Sublimation Ink: ${num(t.inkCharge).toFixed(2)}</div> : null}
                  <div className="tiny"><b>Subtotal</b>: ${num(t.totalChargePreTax).toFixed(2)}</div>
                  <div className="tiny">Discount: −${num(discountAmt).toFixed(2)}</div>
                  <div className="tiny">Tax ({num(settings?.tax_rate).toFixed(2)}%): ${num(tax).toFixed(2)}</div>
                  <div className="tiny">Deposit: −${num(disc.deposit).toFixed(2)}</div>
                  <div className="tiny"><b>Total</b>: ${num(grand).toFixed(2)}</div>
                </div>
              );
            })()}
          </div>
        </div>
      ):null}

      {/* List */}
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
                  <td style={{textAlign:"right"}}>${num(c.pre).toFixed(2)}</td>
                  <td style={{textAlign:"right"}}>${num(c.grand).toFixed(2)}</td>
                  <td style={{textAlign:"right"}}>
                    <div className="btn-row" style={{justifyContent:"flex-end"}}>
                      <button className="btn" onClick={()=>openView(r)}>View</button>
                      <button className="btn" onClick={()=>setEditing(r)}>Edit</button>
                      <button className="btn" onClick={()=>generatePdf(r)}><i className="fa-regular fa-file-pdf"/> PDF</button>
                      <button className="btn" onClick={()=>openEmail(r)}><i className="fa-regular fa-envelope"/> Email</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length===0? <tr><td colSpan={6} className="tiny">No invoices yet.</td></tr> : null}
          </tbody>
        </table>
      </div>

      {/* Email modal */}
      <Confirm
        open={!!emailFor}
        title={`Email ${emailFor?.code || ""}`}
        message={(
          <span>
            <label className="tiny">Recipient</label>
            <input
              id="invmail"
              type="email"
              placeholder="name@company.com"
              style={{width:'100%'}}
              defaultValue={emailDefault || ""}
            />
          </span>
        )}
        onYes={()=>{
          const to=document.getElementById('invmail')?.value?.trim();
          if(!to) return alert('Enter an email');
          emailInvoice(emailFor, to);
        }}
        onNo={()=>{ setEmailFor(null); setEmailDefault(""); }}
      />

      {/* PDF preview modal */}
      {pdfOpen ? (
        <div className="modal" onClick={()=>setPdfOpen(false)}>
          <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
            <div className="row">
              <h3 style={{margin:0}}>PDF Preview</h3>
              <div className="btn-row">
                <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer">Open in new tab</a>
                <button className="btn btn-secondary" onClick={()=>setPdfOpen(false)}>Close</button>
              </div>
            </div>
            <iframe title="invoice-pdf" src={pdfUrl} style={{width:'100%', height:'70vh', border:'1px solid #eee'}}/>
          </div>
        </div>
      ):null}

      <div ref={printRef} style={{position:"fixed", left:-9999, top:-9999}}/>
    </section>
  );
}
