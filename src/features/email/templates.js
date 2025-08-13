// src/features/email/templates.js

/**
 * Tiny mustache-style renderer:
 * - Supports nested keys: {{invoice.code}}, {{business.name}}
 * - Supports flat aliases we expose below: {{invoice_code}}, {{business_name}}, etc.
 */
export function renderTemplate(tpl, ctx) {
  if (!tpl || typeof tpl !== "string") return "";
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    // Try nested path first
    const parts = key.split(".");
    let v = ctx;
    for (const p of parts) v = v?.[p];
    // If not found, try flat alias
    if (v == null) v = ctx?.[key];
    return v == null ? "" : String(v);
  });
}

/* -------------------- INVOICE -------------------- */

export function invoiceDefaults() {
  // Default subject + HTML that work with BOTH nested and flat placeholders
  return {
    subject: "Invoice {{invoice.code}} from {{business.name}}",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06);overflow:hidden;">
          <div style="padding:20px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:center;">
            <img src="{{logo_url}}" alt="" style="height:32px;display:{{logo_url_display}}"/>
            <div style="font-weight:700;font-size:18px">{{business.name}}</div>
          </div>
          <div style="padding:20px">
            <h2 style="margin:0 0 6px">Invoice {{invoice.code}}</h2>
            <div style="color:#666;font-size:13px;margin-bottom:14px">{{date}}</div>

            <p style="margin:0 0 10px">Hello {{customer.name}},</p>
            <p style="margin:0 0 16px">Please find your invoice attached. Summary:</p>

            <table style="width:100%;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 0">Subtotal</td><td style="padding:6px 0;text-align:right">{{subtotal}}</td></tr>
              <tr><td style="padding:6px 0">Tax</td><td style="padding:6px 0;text-align:right">{{tax}}</td></tr>
              <tr><td style="padding:6px 0">Discount</td><td style="padding:6px 0;text-align:right">{{discount}}</td></tr>
              <tr><td style="padding:6px 0">Deposit</td><td style="padding:6px 0;text-align:right">{{deposit}}</td></tr>
              <tr>
                <td style="padding:8px 0;font-weight:700;border-top:1px solid #eee">Total Due</td>
                <td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #eee">{{grand_total}}</td>
              </tr>
            </table>

            <div style="margin-top:16px">
              <a href="{{pdf_url}}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none">View invoice PDF</a>
            </div>
          </div>
          <div style="padding:12px 20px;background:#fafafa;color:#777;font-size:12px;border-top:1px solid #eee">
            Sent by {{business.name}} • {{business.email}}
          </div>
        </div>
      </div>`
  };
}

/**
 * Build a context object for invoices with both nested AND flat aliases.
 * Pass the exact invoice row, customer object, and settings row you already fetch.
 * Also pass an optional signed PDF url as pdfUrl if you have it.
 */
export function buildInvoiceContext({ invoice, customer, settings, pdfUrl }) {
  const money = toMoney;

  const nested = {
    business: {
      name: settings?.business_name || "",
      email: settings?.business_email || ""
    },
    logo_url: settings?.brand_logo_url || "",
    logo_url_display: settings?.brand_logo_url ? "inline-block" : "none",
    date: fmtDate(invoice?.created_at),
    invoice: { code: invoice?.code, created_at: invoice?.created_at },
    customer: { name: customer?.name || "", email: customer?.email || "" },
    // Totals (we compute from invoice.totals when present)
    subtotal: money(invoice?.totals?.totalChargePreTax ?? invoice?.totals?.subtotal ?? invoice?.totals?.totalCharge ?? 0),
    tax:      money(invoice?.totals?.tax ?? 0),
    discount: money(resolveDiscountAmount(invoice)),
    deposit:  money(resolveDepositAmount(invoice)),
    grand_total: money(invoice?.totals?.grand ?? 0),
    pdf_url: pdfUrl || ""
  };

  // Flat aliases for backward compatibility (old templates)
  const flatAliases = {
    business_name: nested.business.name,
    business_email: nested.business.email,
    logo_url: nested.logo_url,
    logo_url_display: nested.logo_url_display,
    date: nested.date,
    invoice_code: nested.invoice.code,
    customer_name: nested.customer.name,
    customer_email: nested.customer.email,
    subtotal: nested.subtotal,
    tax: nested.tax,
    discount: nested.discount,
    deposit: nested.deposit,
    grand_total: nested.grand_total,
    pdf_url: nested.pdf_url
  };

  return { ...nested, ...flatAliases, money };
}

/* -------------------- PURCHASE ORDER -------------------- */

export function poDefaults() {
  return {
    subject: "Purchase Order {{po.code}} from {{business.name}}",
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px;">
        <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06)">
          <div style="padding:20px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:center;">
            <img src="{{logo_url}}" alt="" style="height:32px;display:{{logo_url_display}}"/>
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
              <a href="{{pdf_url}}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none">View PO PDF</a>
            </div>
          </div>

          <div style="padding:12px 20px;background:#fafafa;color:#777;font-size:12px;border-top:1px solid #eee">
            Sent by {{business.name}} • {{business.email}}
          </div>
        </div>
      </div>`
  };
}

/**
 * Build a context for purchase orders (nested + flat aliases).
 * itemsCount is optional (number). pdfUrl optional.
 */
export function buildPOContext({ po, vendor, settings, itemsCount, pdfUrl }) {
  const nested = {
    business: {
      name: settings?.business_name || "",
      email: settings?.business_email || ""
    },
    logo_url: settings?.brand_logo_url || "",
    logo_url_display: settings?.brand_logo_url ? "inline-block" : "none",
    date: fmtDate(po?.created_at),
    po: { code: po?.code, created_at: po?.created_at },
    vendor: { name: vendor?.name || "", email: vendor?.email || "" },
    items_count: itemsCount ?? "",
    pdf_url: pdfUrl || ""
  };

  const flatAliases = {
    business_name: nested.business.name,
    business_email: nested.business.email,
    logo_url: nested.logo_url,
    logo_url_display: nested.logo_url_display,
    date: nested.date,
    po_code: nested.po.code,
    vendor_name: nested.vendor.name,
    vendor_email: nested.vendor.email,
    items_count: nested.items_count,
    pdf_url: nested.pdf_url
  };

  return { ...nested, ...flatAliases };
}

/* -------------------- helpers -------------------- */

function toMoney(n) {
  const num = Number(n || 0);
  return `$${num.toFixed(2)}`;
}

function fmtDate(iso) {
  try {
    return iso ? new Date(iso).toLocaleDateString() : "";
  } catch {
    return "";
  }
}

function resolveDiscountAmount(invoice) {
  // Prefer totals.discount if present; otherwise compute from edit fields
  if (typeof invoice?.totals?.discount === "number") return invoice.totals.discount;
  const type = invoice?.discount_type;
  const val = Number(invoice?.discount_value || 0);
  const base = Number(invoice?.totals?.totalChargePreTax ?? 0);
  if (!val || val <= 0) return 0;
  if (type === "percent") return (base * val) / 100;
  if (type === "flat") return val;
  return 0;
}

function resolveDepositAmount(invoice) {
  if (typeof invoice?.totals?.deposit === "number") return invoice.totals.deposit;
  const v = Number(invoice?.deposit_amount || 0);
  return Number.isFinite(v) ? v : 0;
}
