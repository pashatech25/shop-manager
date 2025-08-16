import {useEffect, useRef, useState} from "react";
import {useTenant} from "../context/TenantContext.jsx";
import {supabase} from "../lib/superbase.js";
import Editor from "../features/invoices/Editor.jsx";
import {captureElementToPdf} from "../features/pdf/service.js";
import Confirm from "../features/ui/Confirm.jsx";
// email templates (exactly like PO page)
import {
  renderTemplate,
  invoiceDefaults,
  buildInvoiceContext,
} from "../features/email/templates.js";
import { sendEmailDoc } from "../lib/email.js";



/* ========================================================================== */
/*                               HELPER FUNCTIONS                            */
/* ========================================================================== */

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

/* ========================================================================== */
/*                                MAIN COMPONENT                             */
/* ========================================================================== */

export default function Invoices(){
  // ==================== STATE ====================
  const {tenantId} = useTenant();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const [viewRow, setViewRow] = useState(null);
  const [viewCustomer, setViewCustomer] = useState(null);
  const [settings, setSettings] = useState(null);

  // Email + PDF preview
  const [emailFor, setEmailFor] = useState(null);
  const [emailDefault, setEmailDefault] = useState(""); // <-- prefill here
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const printRef = useRef(null);

  // ==================== DATA LOADING ====================
  
  const load = async () => {
    if(!tenantId) return;
    const {data} = await supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at",{ascending:false});
    setRows(data||[]);
    const {data:st} = await supabase
      .from("settings")
      .select("tax_rate,currency")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    setSettings(st||{tax_rate:0,currency:"USD"});
  };
  
  useEffect(()=>{ load(); },[tenantId]);

  // ==================== INVOICE VIEW ====================
  
  const openView = async (row) => {
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

  // ==================== PDF GENERATION ====================
  
  const generatePdf = async (r) => {
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

    const {url} = await captureElementToPdf({element: printRef.current, tenantId, kind:"invoices", code:r.code});
    setPdfUrl(url);
    setPdfOpen(true);
  };

  // ==================== EMAIL FUNCTIONALITY ====================
  
  const openEmail = async (r) => {
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
async function ensureInvoicePdf(inv, settings) {
  // If a pdf_path already exists, just sign and return
  if (inv.pdf_path) {
    const { data, error } = await supabase.storage.from("pdfs").createSignedUrl(inv.pdf_path, 60 * 60);
    if (!error && data?.signedUrl) {
      return { path: inv.pdf_path, signedUrl: data.signedUrl };
    }
  }

  // Otherwise generate a quick PDF using your existing PDF service
  // We'll render a minimal printable HTML (or reuse your existing print content if you already have one)
  const tenantId = inv.tenant_id;
  const code = inv.code;

  // Build a simple HTML snapshot (safe, neutral)
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.top = "-9999px";
  container.style.width = "800px";
  container.innerHTML = `
    <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h2 style="margin:0 0 6px 0;">Invoice</h2>
          <div class="mono"># ${escapeHtml(code)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:14px">${escapeHtml(settings?.business_name || "")}</div>
          <div style="font-size:12px; color:#555">${escapeHtml(settings?.business_email || "")}</div>
        </div>
      </div>
      <div style="margin:12px 0; height:1px; background:#eee;"></div>
      <table style="width:100%; border-collapse:collapse; font-size:14px">
        <tbody>
          <tr><td style="padding:6px 4px;">Subtotal</td><td style="padding:6px 4px; text-align:right;">$${Number(inv?.totals?.totalChargePreTax || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:6px 4px;">Tax</td><td style="padding:6px 4px; text-align:right;">$${Number(inv?.totals?.tax || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:6px 4px;">Discount</td><td style="padding:6px 4px; text-align:right;">$${Number(inv?.totals?.discount || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:6px 4px;">Deposit</td><td style="padding:6px 4px; text-align:right;">$${Number(inv?.totals?.deposit || 0).toFixed(2)}</td></tr>
          <tr><td style="padding:8px 4px; font-weight:700; border-top:1px solid #eee">Total</td><td style="padding:8px 4px; text-align:right; font-weight:700; border-top:1px solid #eee">$${Number(inv?.totals?.grand || 0).toFixed(2)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
  document.body.appendChild(container);

  try {
    const { path, url } = await captureElementToPdf({
      element: container,
      tenantId,
      kind: "invoices",
      code
    });

    // update record
    await supabase.from("invoices").update({ pdf_path: path }).eq("id", inv.id).eq("tenant_id", tenantId);

    // sign it
    const { data, error } = await supabase.storage.from("pdfs").createSignedUrl(path, 60 * 60);
    if (!error && data?.signedUrl) {
      return { path, signedUrl: data.signedUrl };
    }
    return { path };
  } finally {
    document.body.removeChild(container);
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}


// Sends the invoice email using the saved (or default) template.
// Expects: tenantId in scope, supabase import, and a Confirm modal that passes `to`.
// Call with: await emailInvoice(inv, to)
async function emailInvoice(inv, toOverride) {
  try {
    const tenantId = inv.tenant_id;

    // 1) Load settings + customer
    const [{ data: settings }, { data: customer }] = await Promise.all([
      supabase.from("settings").select("*").eq("tenant_id", tenantId).single(),
      supabase.from("customers").select("id,name,email").eq("id", inv.customer_id).single(),
    ]);

    // 2) Ensure there is a PDF in storage; if not, generate and save
    const pdfInfo = await ensureInvoicePdf(inv, settings);

    // 3) Build template context
    const ctx = buildInvoiceContext({
      invoice: inv,
      customer,
      settings,
      pdfUrl: pdfInfo?.signedUrl || "", // visible link in template
    });

    // 4) Pick subject/body template (settings override or defaults)
    const { subject: subjDefault, html: htmlDefault } = invoiceDefaults();
    const subjectTpl = settings?.email_invoice_subject || subjDefault;
    const htmlTpl    = settings?.email_invoice_template_html || htmlDefault;

    const subject = renderTemplate(subjectTpl, ctx);
    const html    = renderTemplate(htmlTpl, ctx);

    // 5) Determine recipient (prefer override; else customer.email)
    const to = (toOverride || customer?.email || "").trim();
    if (!to) throw new Error("Customer email not found. You can override it in the dialog.");

    // 6) Attach the PDF using a signed URL (Edge function will fetch it)
    const attachments = pdfInfo?.signedUrl
      ? [{ filename: `${inv.code}.pdf`, url: pdfInfo.signedUrl }]
      : [];

    // 7) Send via your Edge Function wrapper
    await sendEmailDoc({ to, subject, html, attachments });
    alert("Invoice email sent.");
    setEmailFor(null);
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to send invoice email");
  }
}



  // ==================== TABLE CALCULATIONS ====================
  
  const rowCalc = (r) => {
    const t = r?.totals||{};
    const recomputedPre = num(t.totalChargePreTax,
      num(t.equipmentCharge)+num(t.materialsCharge)+num(t.laborCharge)+num(t.addonsCharge)+num(t.inkCharge)
    );
    const disc = extractDiscountModel(r);
    const {discountAmt, tax, grand} = computeBill(recomputedPre, disc, settings?.tax_rate);
    return {pre: recomputedPre, discountAmt, tax, grand};
  };

  // ==================== RENDER ====================
  
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

      {/* INVOICE VIEW MODAL */}
      {viewRow? (
        <InvoiceViewModal
          viewRow={viewRow}
          viewCustomer={viewCustomer}
          settings={settings}
          onClose={() => setViewRow(null)}
          onGeneratePdf={() => generatePdf(viewRow)}
          onOpenEmail={() => openEmail(viewRow)}
        />
      ):null}

      {/* INVOICES TABLE */}
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

      {/* MODALS */}
      
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

      {/* Hidden print element */}
      <div ref={printRef} style={{position:"fixed", left:-9999, top:-9999}}/>
    </section>
  );
}

/* ========================================================================== */
/*                             INVOICE VIEW MODAL                            */
/* ========================================================================== */

function InvoiceViewModal({viewRow, viewCustomer, settings, onClose, onGeneratePdf, onOpenEmail}) {
  const t = viewRow?.totals || {};
  const disc = extractDiscountModel(viewRow);
  const {discountAmt, tax, grand} = computeBill(num(t.totalChargePreTax), disc, settings?.tax_rate);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        
        {/* MODAL HEADER */}
        <InvoiceModalHeader 
          invoiceCode={viewRow.code}
          onGeneratePdf={onGeneratePdf}
          onOpenEmail={onOpenEmail}
          onClose={onClose}
        />
        
        {/* INVOICE INFO HEADER */}
        <InvoiceInfoHeader 
          createdAt={viewRow.created_at}
          title={viewRow.title}
        />

        {/* MODAL CONTENT */}
        <div className="modal-body" style={{maxHeight:'60vh', overflowY:'auto', padding:'8px 0'}}>
          
          {/* CUSTOMER SECTION */}
          {viewCustomer && (
            <InvoiceDetailSection title="Customer Information" icon="👤">
              <CustomerInfo customer={viewCustomer} />
            </InvoiceDetailSection>
          )}

          {/* CHARGES BREAKDOWN SECTION */}
          <InvoiceDetailSection title="Charges Breakdown" icon="💰">
            <ChargesBreakdown 
              totals={t}
              discount={disc}
              discountAmt={discountAmt}
              tax={tax}
              taxRate={settings?.tax_rate}
              grand={grand}
            />
          </InvoiceDetailSection>

        </div>
        
      </div>
    </div>
  );
}

/* ========================================================================== */
/*                         INVOICE MODAL SUB-COMPONENTS                      */
/* ========================================================================== */

function InvoiceModalHeader({invoiceCode, onGeneratePdf, onOpenEmail, onClose}) {
  return (
    <div className="row" style={{borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '16px'}}>
      <div>
        <h3 style={{margin:0, fontSize:'24px', fontWeight:'600'}}>
          Invoice Details
        </h3>
        <div className="tiny mono" style={{color:'#666', marginTop:'4px'}}>
          #{invoiceCode}
        </div>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={onGeneratePdf} title="Generate PDF">
          <i className="fa-regular fa-file-pdf"/> PDF
        </button>
        <button className="btn" onClick={onOpenEmail} title="Email Invoice">
          <i className="fa-regular fa-envelope"/> Email
        </button>
        <button className="btn" onClick={onClose} title="Close modal">
          <i className="fa-solid fa-times"/>
        </button>
      </div>
    </div>
  );
}

function InvoiceInfoHeader({createdAt, title}) {
  return (
    <div className="invoice-info-header" style={{
      background: '#f8f9fa', 
      padding: '12px 16px', 
      borderRadius: '8px', 
      marginBottom: '20px',
      border: '1px solid #e9ecef'
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px'}}>
        <h4 style={{margin:0, fontSize:'18px', color:'#333'}}>{title || 'Invoice'}</h4>
        <span className="badge" style={{background:'#28a745', color:'white'}}>
          Active
        </span>
      </div>
      <div style={{fontSize:'14px', color:'#666'}}>
        <i className="fa-regular fa-calendar"/> Created: {new Date(createdAt).toLocaleString()}
      </div>
    </div>
  );
}

function InvoiceDetailSection({title, icon, children}) {
  return (
    <div className="detail-section" style={{marginBottom:'16px'}}>
      <div style={{
        display:'flex', 
        alignItems:'center', 
        gap:'8px', 
        marginBottom:'8px',
        paddingBottom:'6px',
        borderBottom:'2px solid #f0f0f0'
      }}>
        <span style={{fontSize:'18px'}}>{icon}</span>
        <h4 style={{margin:0, fontSize:'16px', fontWeight:'600', color:'#333'}}>{title}</h4>
      </div>
      <div style={{paddingLeft:'18px'}}>
        {children}
      </div>
    </div>
  );
}

function CustomerInfo({customer}) {
  return (
    <div style={{
      padding:'12px', 
      background:'#f8f9fa', 
      borderRadius:'8px',
      border:'1px solid #e9ecef'
    }}>
      <div style={{marginBottom:'8px', fontSize:'16px', fontWeight:'600', color:'#333'}}>
        {customer.company || customer.name}
      </div>
      {customer.email && (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-regular fa-envelope" style={{marginRight:'8px'}}/>
          {customer.email}
        </div>
      )}
      {customer.phone && (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-phone" style={{marginRight:'8px'}}/>
          {customer.phone}
        </div>
      )}
      {customer.address && (
        <div style={{fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-location-dot" style={{marginRight:'8px'}}/>
          {customer.address}
        </div>
      )}
    </div>
  );
}

function ChargesBreakdown({totals, discount, discountAmt, tax, taxRate, grand}) {
  return (
    <div style={{
      padding:'16px', 
      background:'#f8f9fa', 
      borderRadius:'8px',
      border:'1px solid #e9ecef'
    }}>
      {/* Line Items */}
      <div style={{marginBottom:'16px'}}>
        <ChargeLineItem label="Equipment" amount={num(totals.equipmentCharge)} />
        <ChargeLineItem label="Materials" amount={num(totals.materialsCharge)} />
        <ChargeLineItem label="Labor" amount={num(totals.laborCharge)} />
        <ChargeLineItem label="Add-ons" amount={num(totals.addonsCharge)} />
        {discount.showInk && (
          <ChargeLineItem label="UV/Sublimation Ink" amount={num(totals.inkCharge)} />
        )}
      </div>

      {/* Subtotal */}
      <div style={{
        borderTop:'1px solid #dee2e6', 
        paddingTop:'12px', 
        marginBottom:'12px'
      }}>
        <ChargeLineItem label="Subtotal" amount={num(totals.totalChargePreTax)} bold />
      </div>

      {/* Adjustments */}
      <div style={{marginBottom:'12px'}}>
        <ChargeLineItem label="Discount" amount={-num(discountAmt)} color="#dc3545" />
        <ChargeLineItem label={`Tax (${num(taxRate).toFixed(2)}%)`} amount={num(tax)} />
        <ChargeLineItem label="Deposit" amount={-num(discount.deposit)} color="#dc3545" />
      </div>

      {/* Total */}
      <div style={{
        borderTop:'2px solid #dee2e6', 
        paddingTop:'12px',
        background:'white',
        borderRadius:'6px',
        padding:'12px'
      }}>
        <ChargeLineItem label="Total" amount={num(grand)} bold large />
      </div>
    </div>
  );
}

function ChargeLineItem({label, amount, bold = false, large = false, color = null}) {
  const isNegative = amount < 0;
  const displayAmount = Math.abs(amount);
  
  return (
    <div style={{
      display:'flex', 
      justifyContent:'space-between', 
      alignItems:'center',
      marginBottom:'6px',
      fontSize: large ? '18px' : '14px'
    }}>
      <span style={{
        fontWeight: bold ? '600' : '400',
        color: color || '#333'
      }}>
        {label}
      </span>
      <span style={{
        fontWeight: bold ? '700' : '500',
        color: color || (isNegative ? '#dc3545' : '#333'),
        fontSize: large ? '20px' : '14px'
      }}>
        {isNegative ? '−' : ''}${displayAmount.toFixed(2)}
      </span>
    </div>
  );
}