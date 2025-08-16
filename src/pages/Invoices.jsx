import {useEffect, useRef, useState} from "react";
import {useTenant} from "../context/TenantContext.jsx";
import {supabase} from "../lib/superbase.js";
import Editor from "../features/invoices/Editor.jsx";
import {captureElementToPdf} from "../features/pdf/service.js";
import Confirm from "../features/ui/Confirm.jsx";
import {
  renderTemplate,
  invoiceDefaults,
  buildInvoiceContext,
} from "../features/email/templates.js";
import { sendEmailDoc } from "../lib/email.js";

// ---------- tiny utils ----------
const num = (v, d=0)=> {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[m]));
const safeLine = (s) => (s ? `<div style="font-size:13px; color:#555">${esc(s)}</div>` : "");

// ---------- settings helpers ----------
async function fetchSettingsOrThrow(tenantId) {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("No business settings row found for this tenant.");

  const s = { ...data };

  // Normalize common keys used by UI / PDF
  s.business_name   = s.business_name   ?? s.name ?? s.company_name ?? s.org_name ?? "";
  s.business_email  = s.business_email  ?? s.email ?? s.contact_email ?? "";
  s.business_phone  = s.business_phone  ?? s.phone ?? s.contact_phone ?? "";
  s.business_address= s.business_address?? s.address ?? s.street_address ?? "";

  s.brand_logo_url  = s.brand_logo_url ?? s.logo_url ?? "";
  s.brand_logo_path = s.brand_logo_path ?? s.brand_logo ?? s.logo_path ?? "";

  s.tax_rate        = num(s.tax_rate, 0);
  s.currency        = s.currency || "USD";

  return s;
}

async function resolveLogoUrl(settings) {
  if (!settings) return "";
  if (settings.brand_logo_url) return settings.brand_logo_url;

  const path = settings.brand_logo_path || "";
  if (!path) return "";

  async function tryBucket(bucket) {
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      if (data?.publicUrl) return data.publicUrl;
    } catch (_) {}
    try {
      const { data, error } = await supabase
        .storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);
      if (!error && data?.signedUrl) return data.signedUrl;
    } catch (_) {}
    return "";
  }

  return (await tryBucket("branding")) || (await tryBucket("Branding")) || "";
}

// ---------- data helpers ----------
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

function recomputeChargesFromItems(items, {matMap, eqMap}, marginPct=100){
  const mats = Array.isArray(items?.materials)? items.materials : [];
  const eqs  = Array.isArray(items?.equipments)? items.equipments : [];
  const adds = Array.isArray(items?.addons)? items.addons : [];
  const labs = Array.isArray(items?.labor)? items.labor : [];

  let materialsCharge=0;
  for(const l of mats){
    materialsCharge += num(l.qty)*num(matMap.get(l.material_id));
  }

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

  let laborCharge=0;   for(const l of labs){ laborCharge += num(l.hours)*num(l.rate); }
  let addonsCharge=0;  for(const a of adds){ addonsCharge += num(a.qty)*num(a.price); }

  const preTax = equipmentCharge + materialsCharge + laborCharge + addonsCharge + inkCharge;
  return {equipmentCharge, materialsCharge, laborCharge, addonsCharge, inkCharge, preTax};
}

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

function computeBill(preTax, {type, value, applyTax, deposit}, taxRatePct){
  const discountAmt = (type==="percent") ? (preTax * (num(value)/100)) : num(value);
  if (applyTax) {
    const base = Math.max(0, preTax - discountAmt);
    const tax  = base * (num(taxRatePct)/100);
    const grand = Math.max(0, base + tax - num(deposit));
    return {discountAmt, tax, grand};
  } else {
    const tax  = preTax * (num(taxRatePct)/100);
    const subtotalAfterTax = preTax + tax;
    const grand = Math.max(0, subtotalAfterTax - discountAmt - num(deposit));
    return {discountAmt, tax, grand};
  }
}

// ---------- one HTML builder used by both preview & email attachment ----------
function buildInvoiceHtml({inv, charges, disc, tax, grand, settings, customer, logoUrl}) {
  const c = customer || {};
  const billToHtml = `
    <div style="flex:1">
      <div style="font-size:12px; color:#888; margin-bottom:6px;">Bill To</div>
      ${safeLine(c.name || c.company)}
      ${c.company && c.name ? safeLine(c.company) : ""}
      ${safeLine(c.email)}
      ${safeLine(c.phone)}
      ${safeLine(c.address)}
    </div>
  `;

  const fromHtml = `
    <div style="flex:1; text-align:right">
      <div style="font-size:12px; color:#888; margin-bottom:6px;">From</div>
      ${safeLine(settings?.business_name)}
      ${safeLine(settings?.business_email)}
      ${safeLine(settings?.business_phone)}
      ${safeLine(settings?.business_address)}
    </div>
  `;

  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#F6F7F9; padding:24px; width:800px;">
    <div style="max-width:800px; margin:0 auto; background:#fff; border-radius:16px; box-shadow:0 12px 30px rgba(0,0,0,.06); overflow:hidden;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:20px 24px; border-bottom:1px solid #eee;">
        <div>
          <div style="font-size:13px; color:#888; letter-spacing:.08em;">INVOICE</div>
          <div style="font-weight:700; font-size:22px; margin-top:4px;">#${esc(inv.code)}</div>
          <div style="font-size:12px; color:#666; margin-top:2px;">${new Date(inv.created_at).toLocaleString()}</div>
        </div>
        <div>
          ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="height:40px; object-fit:contain;"/>`
                    : `<div style="font-weight:700;font-size:18px">${esc(settings?.business_name || '')}</div>`}
        </div>
      </div>
      <div style="display:flex; gap:24px; padding:18px 24px 6px 24px;">
        ${billToHtml}
        ${fromHtml}
      </div>
      <div style="padding:16px 24px 6px 24px;">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tbody>
            <tr><td style="padding:6px 0; color:#222;">Equipment</td><td style="padding:6px 0; text-align:right;">$${Number(charges.equipmentCharge).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0; color:#222;">Materials</td><td style="padding:6px 0; text-align:right;">$${Number(charges.materialsCharge).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0; color:#222;">Labor</td><td style="padding:6px 0; text-align:right;">$${Number(charges.laborCharge).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0; color:#222;">Add-ons</td><td style="padding:6px 0; text-align:right;">$${Number(charges.addonsCharge).toFixed(2)}</td></tr>
            ${disc.showInk ? `<tr><td style="padding:6px 0; color:#222;">UV/Sublimation Ink</td><td style="padding:6px 0; text-align:right;">$${Number(charges.inkCharge).toFixed(2)}</td></tr>` : ""}
            <tr><td colspan="2"><div style="height:1px; background:#eee; margin:10px 0;"></div></td></tr>
            <tr><td style="padding:6px 0; font-weight:600;">Subtotal</td><td style="padding:6px 0; text-align:right; font-weight:600;">$${Number(charges.preTax).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0;">Discount</td><td style="padding:6px 0; text-align:right;">−$${Number((disc.type==="percent" ? charges.preTax*(disc.value/100) : disc.value)).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0;">Tax (${Number(settings?.tax_rate||0).toFixed(2)}%)</td><td style="padding:6px 0; text-align:right;">$${Number(tax).toFixed(2)}</td></tr>
            <tr><td style="padding:6px 0;">Deposit</td><td style="padding:6px 0; text-align:right;">−$${Number(disc.deposit).toFixed(2)}</td></tr>
            <tr><td colspan="2"><div style="height:1px; background:#eee; margin:10px 0;"></div></td></tr>
            <tr><td style="padding:8px 0; font-size:16px; font-weight:700;">Total</td><td style="padding:8px 0; text-align:right; font-size:16px; font-weight:700;">$${Number(grand).toFixed(2)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding:12px 24px 20px 24px; color:#666; font-size:12px; border-top:1px solid #f3f3f3; margin-top:8px;">
        Thank you for your business.
      </div>
    </div>
  </div>`;
}

// ---------- main component ----------
export default function Invoices(){
  const {tenantId} = useTenant();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);

  const [viewRow, setViewRow] = useState(null);
  const [viewCustomer, setViewCustomer] = useState(null);
  const [viewSettings, setViewSettings] = useState(null);

  const [settings, setSettings] = useState(null);

  const [emailFor, setEmailFor] = useState(null);
  const [emailDefault, setEmailDefault] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const printRef = useRef(null);

  const load = async () => {
    if(!tenantId) return;
    const {data} = await supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at",{ascending:false});
    setRows(data||[]);

    try {
      const st = await fetchSettingsOrThrow(tenantId);
      setSettings(st);
    } catch (e) {
      console.warn("Settings load failed:", e?.message || e);
      setSettings(null);
    }
  };
  useEffect(()=>{ load(); },[tenantId]);

  const openView = async (row) => {
    try {
      if (!tenantId) return;

      const [st, custRes, maps] = await Promise.all([
        fetchSettingsOrThrow(tenantId),
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

      setViewSettings(st);
      setViewCustomer(custRes.data||null);
      setViewRow({...row, totals});
    } catch (e) {
      console.error("openView error:", e);
      alert("Could not load invoice details.");
    }
  };

  const generatePdf = async (r) => {
    if (!printRef.current) return;

    // Ensure normalized settings
    let st = viewSettings || settings;
    if (!st) {
      try {
        st = await fetchSettingsOrThrow(tenantId);
        setSettings(st);
      } catch (e) {
        alert("Business settings are missing for this tenant. Please complete Settings → Business.");
        return;
      }
    }

    const [{ data: customer }, maps, logoUrl] = await Promise.all([
      r?.customer_id
        ? supabase
            .from("customers")
            .select("id,company,name,email,phone,address,website")
            .eq("id", r.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      loadPriceMaps(tenantId),
      resolveLogoUrl(st),
    ]);

    const marginPct = r?.items?.meta?.marginPct ?? 100;
    const charges = recomputeChargesFromItems(r?.items, maps, marginPct);
    const disc = extractDiscountModel(r);
    const { tax, grand } = computeBill(charges.preTax, disc, st?.tax_rate);

    // Reuse the *same* HTML for screen preview
    const html = buildInvoiceHtml({
      inv: r, charges, disc, tax, grand,
      settings: st,
      customer: customer || {},
      logoUrl
    });

    printRef.current.innerHTML = html;

    const { url } = await captureElementToPdf({
      element: printRef.current,
      tenantId,
      kind: "invoices",
      code: r.code
    });

    setPdfUrl(url);
    setPdfOpen(true);
  };

  // Use the *same* HTML to generate the attachment PDF (offscreen) so it matches the screen preview
  async function ensureInvoicePdf(inv, settingsFull) {
    if (inv.pdf_path) {
      const { data, error } = await supabase.storage.from("pdfs").createSignedUrl(inv.pdf_path, 60 * 60);
      if (!error && data?.signedUrl) {
        return { path: inv.pdf_path, signedUrl: data.signedUrl };
      }
    }

    const [{ data: customer }, maps, logoUrl] = await Promise.all([
      inv?.customer_id
        ? supabase
            .from("customers")
            .select("id,company,name,email,phone,address,website")
            .eq("id", inv.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      loadPriceMaps(inv.tenant_id),
      resolveLogoUrl(settingsFull),
    ]);

    const marginPct = inv?.items?.meta?.marginPct ?? 100;
    const charges   = recomputeChargesFromItems(inv?.items, maps, marginPct);
    const disc      = extractDiscountModel(inv);
    const { tax, grand } = computeBill(charges.preTax, disc, settingsFull?.tax_rate);

    const html = buildInvoiceHtml({
      inv,
      charges,
      disc,
      tax,
      grand,
      settings: settingsFull,
      customer: customer || {},
      logoUrl
    });

    // Render in a detached container for capture
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "-9999px";
    container.style.width = "800px";
    container.innerHTML = html;
    document.body.appendChild(container);

    try {
      const { path } = await captureElementToPdf({
        element: container,
        tenantId: inv.tenant_id,
        kind: "invoices",
        code: inv.code
      });
      await supabase.from("invoices")
        .update({ pdf_path: path })
        .eq("id", inv.id)
        .eq("tenant_id", inv.tenant_id);

      const { data, error } = await supabase.storage
        .from("pdfs")
        .createSignedUrl(path, 60 * 60);
      if (!error && data?.signedUrl) {
        return { path, signedUrl: data.signedUrl };
      }
      return { path };
    } finally {
      document.body.removeChild(container);
    }
  }

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
    }catch(_){}
    setEmailFor(r);
  };

  async function emailInvoice(inv, toOverride) {
    try {
      const tenantId = inv.tenant_id;
      const [settingsFull, custRes] = await Promise.all([
        fetchSettingsOrThrow(tenantId),
        supabase.from("customers").select("id,name,email").eq("id", inv.customer_id).maybeSingle()
      ]);
      const customer = custRes.data || null;

      // Ensure we have the *same* pretty PDF attached
      const pdfInfo = await ensureInvoicePdf(inv, settingsFull);

      // Build subject/body using template engine (unchanged)
      const ctx = buildInvoiceContext({
        invoice: inv,
        customer,
        settings: settingsFull,
        pdfUrl: pdfInfo?.signedUrl || "",
      });
      const { subject: subjDefault, html: htmlDefault } = invoiceDefaults();
      const subjectTpl = settingsFull?.email_invoice_subject || subjDefault;
      const htmlTpl    = settingsFull?.email_invoice_template_html || htmlDefault;
      const subject = renderTemplate(subjectTpl, ctx);
      const html    = renderTemplate(htmlTpl, ctx);

      const to = (toOverride || customer?.email || "").trim();
      if (!to) throw new Error("Customer email not found. You can override it in the dialog.");

      const attachments = pdfInfo?.signedUrl
        ? [{ filename: `${inv.code}.pdf`, url: pdfInfo.signedUrl }]
        : [];

      await sendEmailDoc({ to, subject, html, attachments });
      alert("Invoice email sent.");
      setEmailFor(null);
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to send invoice email");
    }
  }

  const rowCalc = (r) => {
    const t = r?.totals||{};
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
        <InvoiceViewModal
          viewRow={viewRow}
          viewCustomer={viewCustomer}
          settings={viewSettings || settings}
          onClose={() => setViewRow(null)}
          onGeneratePdf={() => generatePdf(viewRow)}
          onOpenEmail={() => openEmail(viewRow)}
        />
      ):null}

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

// ---------- view modal & sections ----------
function InvoiceViewModal({viewRow, viewCustomer, settings, onClose, onGeneratePdf, onOpenEmail}) {
  const t = viewRow?.totals || {};
  const disc = extractDiscountModel(viewRow);
  const {discountAmt, tax, grand} = computeBill(num(t.totalChargePreTax), disc, settings?.tax_rate);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <InvoiceModalHeader 
          invoiceCode={viewRow.code}
          onGeneratePdf={onGeneratePdf}
          onOpenEmail={onOpenEmail}
          onClose={onClose}
        />
        <InvoiceInfoHeader createdAt={viewRow.created_at} title={viewRow.title} />

        <div className="row" style={{gap:16, marginBottom:16}}>
          {viewCustomer ? (
            <div style={{flex:1}}>
              <InvoiceDetailSection title="Bill To" icon="👤">
                <CustomerInfo customer={viewCustomer} />
              </InvoiceDetailSection>
            </div>
          ) : null}
          <div style={{flex:1}}>
            <InvoiceDetailSection title="From" icon="🏢">
              <BusinessInfo settings={settings}/>
            </InvoiceDetailSection>
          </div>
        </div>

        <div className="modal-body" style={{maxHeight:'60vh', overflowY:'auto', padding:'8px 0'}}>
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

function InvoiceModalHeader({invoiceCode, onGeneratePdf, onOpenEmail, onClose}) {
  return (
    <div className="row" style={{borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '16px'}}>
      <div>
        <h3 style={{margin:0, fontSize:'24px', fontWeight:'600'}}>Invoice Details</h3>
        <div className="tiny mono" style={{color:'#666', marginTop:'4px'}}>#{invoiceCode}</div>
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
      background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px',
      marginBottom: '20px', border: '1px solid #e9ecef'
    }}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px'}}>
        <h4 style={{margin:0, fontSize:'18px', color:'#333'}}>{title || 'Invoice'}</h4>
        <span className="badge" style={{background:'#28a745', color:'white'}}>Active</span>
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
      <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px', paddingBottom:'6px', borderBottom:'2px solid #f0f0f0'}}>
        <span style={{fontSize:'18px'}}>{icon}</span>
        <h4 style={{margin:0, fontSize:'16px', fontWeight:'600', color:'#333'}}>{title}</h4>
      </div>
      <div style={{paddingLeft:'18px'}}>{children}</div>
    </div>
  );
}

function CustomerInfo({customer}) {
  return (
    <div style={{padding:'12px', background:'#f8f9fa', borderRadius:'8px', border:'1px solid #e9ecef'}}>
      <div style={{marginBottom:'8px', fontSize:'16px', fontWeight:'600', color:'#333'}}>
        {customer.company || customer.name}
      </div>
      {customer.email && (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-regular fa-envelope" style={{marginRight:'8px'}}/>{customer.email}
        </div>
      )}
      {customer.phone && (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-phone" style={{marginRight:'8px'}}/>{customer.phone}
        </div>
      )}
      {customer.address && (
        <div style={{fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-location-dot" style={{marginRight:'8px'}}/>{customer.address}
        </div>
      )}
    </div>
  );
}

function BusinessInfo({settings}) {
  const s = settings || {};
  return (
    <div style={{padding:'12px', background:'#f8f9fa', borderRadius:'8px', border:'1px solid #e9ecef'}}>
      <div style={{marginBottom:'8px', fontSize:'16px', fontWeight:'600', color:'#333'}}>
        {s.business_name || '—'}
      </div>
      {s.business_email ? (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-regular fa-envelope" style={{marginRight:'8px'}}/>{s.business_email}
        </div>
      ) : null}
      {s.business_phone ? (
        <div style={{marginBottom:'4px', fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-phone" style={{marginRight:'8px'}}/>{s.business_phone}
        </div>
      ) : null}
      {s.business_address ? (
        <div style={{fontSize:'14px', color:'#666'}}>
          <i className="fa-solid fa-location-dot" style={{marginRight:'8px'}}/>{s.business_address}
        </div>
      ) : null}
    </div>
  );
}

function ChargesBreakdown({totals, discount, discountAmt, tax, taxRate, grand}) {
  return (
    <div style={{padding:'16px', background:'#f8f9fa', borderRadius:'8px', border:'1px solid #e9ecef'}}>
      <div style={{marginBottom:'16px'}}>
        <ChargeLineItem label="Equipment" amount={num(totals.equipmentCharge)} />
        <ChargeLineItem label="Materials" amount={num(totals.materialsCharge)} />
        <ChargeLineItem label="Labor" amount={num(totals.laborCharge)} />
        <ChargeLineItem label="Add-ons" amount={num(totals.addonsCharge)} />
        {discount.showInk && (
          <ChargeLineItem label="UV/Sublimation Ink" amount={num(totals.inkCharge)} />
        )}
      </div>
      <div style={{borderTop:'1px solid #dee2e6', paddingTop:'12px', marginBottom:'12px'}}>
        <ChargeLineItem label="Subtotal" amount={num(totals.totalChargePreTax)} bold />
      </div>
      <div style={{marginBottom:'12px'}}>
        <ChargeLineItem label="Discount" amount={-num(discountAmt)} color="#dc3545" />
        <ChargeLineItem label={`Tax (${num(taxRate).toFixed(2)}%)`} amount={num(tax)} />
        <ChargeLineItem label="Deposit" amount={-num(discount.deposit)} color="#dc3545" />
      </div>
      <div style={{borderTop:'2px solid #dee2e6', paddingTop:'12px', background:'white', borderRadius:'6px', padding:'12px'}}>
        <ChargeLineItem label="Total" amount={num(grand)} bold large />
      </div>
    </div>
  );
}

function ChargeLineItem({label, amount, bold = false, large = false, color = null}) {
  const isNegative = amount < 0;
  const displayAmount = Math.abs(amount);
  return (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px', fontSize: large ? '18px' : '14px'}}>
      <span style={{fontWeight: bold ? '600' : '400', color: color || '#333'}}>
        {label}
      </span>
      <span style={{fontWeight: bold ? '700' : '500', color: color || (isNegative ? '#dc3545' : '#333'), fontSize: large ? '20px' : '14px'}}>
        {isNegative ? '−' : ''}${displayAmount.toFixed(2)}
      </span>
    </div>
  );
}
