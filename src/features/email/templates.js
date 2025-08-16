// src/features/email/templates.js
import { supabase } from "../../lib/superbase.js";

/* ---------------- small utils ---------------- */

const get = (obj, path, dflt=undefined) => {
  try {
    return path.split('.').reduce((o,k)=> (o==null? undefined : o[k]), obj) ?? dflt;
  } catch { return dflt; }
};

const num = (v, d=0) => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : d;
};

const money = (v) => `$${num(v,0).toFixed(2)}`;
const fmtDate = (iso) => {
  try { return iso ? new Date(iso).toLocaleDateString() : ""; } catch { return ""; }
};

function resolveBrandLogo(settings){
  // prefer uploaded branding path
  if (settings?.brand_logo_path){
    const { data } = supabase.storage.from("branding").getPublicUrl(settings.brand_logo_path);
    const url = data?.publicUrl || "";
    return { url, display: url ? "inline-block" : "none" };
  }
  // fallback to manual URL
  const url = settings?.brand_logo_url || "";
  return { url, display: url ? "inline-block" : "none" };
}

/* -------------- tiny mustache-ish renderer -------------- */
export function renderTemplate(tpl, ctx){
  if (!tpl || typeof tpl !== "string") return "";
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key)=>{
    // nested first
    const parts = key.split(".");
    let v = ctx;
    for (const p of parts) v = v?.[p];
    // flat alias fallback
    if (v == null) v = ctx?.[key];
    return v == null ? "" : String(v);
  });
}

/* -------------------- INVOICE EMAIL -------------------- */

export function invoiceDefaults(){
  return {
    subject: "Invoice {{invoice.code}} from {{business.name}}",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06);overflow:hidden;">
          <div style="padding:20px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:center;">
            <img src="{{assets.logo_url}}" alt="" style="height:32px;display:{{assets.logo_url_display}}"/>
            <div style="font-weight:700;font-size:18px">{{business.name}}</div>
          </div>
          <div style="padding:20px">
            <h2 style="margin:0 0 6px">Invoice {{invoice.code}}</h2>
            <div style="color:#666;font-size:13px;margin-bottom:14px">{{date}}</div>

            <p style="margin:0 0 10px">Hello {{customer.name}},</p>
            <p style="margin:0 0 16px">Please find your invoice attached. Summary:</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0">Subtotal</td><td style="padding:6px 0;text-align:right">{{money.subtotal}}</td></tr>
              <tr><td style="padding:6px 0">Tax</td><td style="padding:6px 0;text-align:right">{{money.tax}}</td></tr>
              <tr><td style="padding:6px 0">Discount</td><td style="padding:6px 0;text-align:right">{{money.discount}}</td></tr>
              <tr><td style="padding:6px 0">Deposit</td><td style="padding:6px 0;text-align:right">{{money.deposit}}</td></tr>
              <tr>
                <td style="padding:8px 0;font-weight:700;border-top:1px solid #eee">Total Due</td>
                <td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eee">{{money.grand}}</td>
              </tr>
            </table>

            <div style="margin-top:16px">
              <a href="{{links.pdf_url}}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none">View invoice PDF</a>
            </div>
          </div>
          <div style="padding:12px 20px;background:#fafafa;color:#777;font-size:12px;border-top:1px solid #eee">
            Sent by {{business.name}} • {{business.email}}
          </div>
        </div>
      </div>`
  };
}

export function buildInvoiceContext({ invoice, customer, settings, pdfUrl }){
  const logo = resolveBrandLogo(settings);

  // 1) Subtotal (pre-tax)
  const subtotalPreTax =
    num(get(invoice, "totals.totalChargePreTax")) ||
    num(get(invoice, "totals.subtotal")) ||
    num(get(invoice, "totals.totalCharge")) - num(get(invoice, "totals.tax")) ||
    0;

  // 2) Discount amount (AMOUNT, not percent)
  const dType = get(invoice, "discount_type");            // 'percent' | 'flat' | undefined
  const dValRaw = get(invoice, "discount_value", get(invoice,"discount", 0));
  const dVal = num(dValRaw, 0);

  // try stored amount first if editor saved it
  let discountAmt =
    num(get(invoice,"totals.discount_amount")) ||
    num(get(invoice,"totals.discount")) ||
    0;

  if (!discountAmt) {
    if (dType === "percent" && dVal > 0) {
      discountAmt = (subtotalPreTax * dVal) / 100;
    } else if (dType === "flat" && dVal > 0) {
      discountAmt = dVal;
    } else {
      // legacy: some rows used invoice.discount as amount without type
      // if so, treat it as a flat amount
      if (!dType && dVal > 0) discountAmt = dVal;
    }
  }
  if (discountAmt > subtotalPreTax) discountAmt = subtotalPreTax;

  // 3) Deposit
  const depositAmt =
    num(get(invoice,"totals.deposit")) ||
    num(get(invoice,"deposit_amount")) ||
    num(get(invoice,"deposit")) ||
    0;

  // 4) Tax
  let taxAmt = num(get(invoice,"totals.tax"));
  if (!taxAmt) {
    const taxPct =
      num(get(invoice,"totals.taxPct")) ||
      num(get(settings,"tax_rate"))     ||
      num(get(invoice,"tax_rate"))      ||
      0;

    const applyTaxToDiscount =
      !!get(invoice,"totals.discountApplyTax") ||
      !!get(invoice,"discount_apply_tax");

    const taxBase = applyTaxToDiscount
      ? Math.max(0, subtotalPreTax - discountAmt)
      : subtotalPreTax;

    taxAmt = (taxPct/100) * taxBase;
  }

  // 5) Grand total
  const grand =
    num(get(invoice,"totals.grand")) ||
    Math.max(0, subtotalPreTax - discountAmt + taxAmt - depositAmt);

  const moneyObj = {
    subtotal: money(subtotalPreTax),
    tax:      money(taxAmt),
    discount: money(discountAmt),
    deposit:  money(depositAmt),
    grand:    money(grand),
  };

  const nested = {
    business: {
      name:  settings?.business_name || "",
      email: settings?.business_email || "",
    },
    assets: {
      logo_url: logo.url,
      logo_url_display: logo.display,
    },
    logo_url: logo.url,
    logo_url_display: logo.display,

    date: fmtDate(invoice?.created_at),
    invoice: { code: invoice?.code, created_at: invoice?.created_at },
    customer: { name: customer?.name || "", email: customer?.email || "" },

    money: moneyObj,

    // legacy flat keys
    subtotal:    moneyObj.subtotal,
    tax:         moneyObj.tax,
    discount:    moneyObj.discount,
    deposit:     moneyObj.deposit,
    grand_total: moneyObj.grand,

    links: { pdf_url: pdfUrl || "" },
    pdf_url: pdfUrl || "",
  };

  const flatAliases = {
    business_name:  nested.business.name,
    business_email: nested.business.email,
    logo_url:       nested.logo_url,
    logo_url_display: nested.logo_url_display,
    date:           nested.date,
    invoice_code:   nested.invoice.code,
    customer_name:  nested.customer.name,
    customer_email: nested.customer.email,
    subtotal:       nested.subtotal,
    tax:            nested.tax,
    discount:       nested.discount,
    deposit:        nested.deposit,
    grand_total:    nested.grand_total,
    pdf_url:        nested.pdf_url,
  };

  return { ...nested, ...flatAliases };
}

/* -------------------- PURCHASE ORDER EMAIL -------------------- */

export function poDefaults(){
  return {
    subject: "Purchase Order {{po.code}} from {{business.name}}",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06)">
          <div style="padding:20px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:center;">
            <img src="{{assets.logo_url}}" alt="" style="height:32px;display:{{assets.logo_url_display}}"/>
            <div style="font-weight:700;font-size:18px">{{business.name}}</div>
          </div>
          <div style="padding:20px">
            <h2 style="margin:0 0 6px">Purchase Order {{po.code}}</h2>
            <div style="color:#666;font-size:13px;margin-bottom:14px">{{date}}</div>

            <p style="margin:0 0 10px">Hello {{vendor.name}},</p>
            <p style="margin:0 0 16px">Please find the purchase order attached.</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0">Items</td><td style="padding:6px 0;text-align:right">{{items_count}}</td></tr>
              <tr><td style="padding:8px 0;font-weight:700;border-top:1px solid #eee">PO Code</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eee">{{po.code}}</td></tr>
            </table>

            <div style="margin-top:16px">
              <a href="{{links.pdf_url}}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none">View PO PDF</a>
            </div>
          </div>
          <div style="padding:12px 20px;background:#fafafa;color:#777;font-size:12px;border-top:1px solid #eee">
            Sent by {{business.name}} • {{business.email}}
          </div>
        </div>
      </div>`
  };
}

export function buildPOContext({ po, vendor, settings, itemsCount, pdfUrl }){
  const logo = resolveBrandLogo(settings);

  const nested = {
    business: {
      name:  settings?.business_name || "",
      email: settings?.business_email || "",
    },
    assets: {
      logo_url: logo.url,
      logo_url_display: logo.display,
    },
    logo_url: logo.url,
    logo_url_display: logo.display,

    date: fmtDate(po?.created_at),
    po: { code: po?.code, created_at: po?.created_at },
    vendor: { name: vendor?.name || "", email: vendor?.email || "" },
    items_count: itemsCount ?? "",

    links: { pdf_url: pdfUrl || "" },
    pdf_url: pdfUrl || "",
  };

  const flatAliases = {
    business_name:  nested.business.name,
    business_email: nested.business.email,
    logo_url:       nested.logo_url,
    logo_url_display: nested.logo_url_display,
    date:           nested.date,
    po_code:        nested.po.code,
    vendor_name:    nested.vendor.name,
    vendor_email:   nested.vendor.email,
    items_count:    nested.items_count,
    pdf_url:        nested.pdf_url,
  };

  return { ...nested, ...flatAliases };
}
