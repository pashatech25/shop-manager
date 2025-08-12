// features/webhook/api.js
import {supabase} from '../../lib/superbase.js';

/**
 * Resolve endpoint/secret for an event from settings (per-trigger fields).
 * Returns { url, secret } or null if disabled/missing.
 */
function resolveTarget(settings, event){
  const map = {
    'quote.created': {
      enabled: settings.webhook_quote_created_enabled,
      url: settings.webhook_quote_created_url,
      secret: settings.webhook_quote_created_secret,
    },
    'quote.to_job': {
      enabled: settings.webhook_quote_to_job_enabled,
      url: settings.webhook_quote_to_job_url,
      secret: settings.webhook_quote_to_job_secret,
    },
    'job.completed': {
      enabled: settings.webhook_job_completed_enabled,
      url: settings.webhook_job_completed_url,
      secret: settings.webhook_job_completed_secret,
    },
    'invoice.generated': {
      enabled: settings.webhook_invoice_generated_enabled,
      url: settings.webhook_invoice_generated_url,
      secret: settings.webhook_invoice_generated_secret,
    },
    'inventory.low_ink': {
      enabled: settings.webhook_low_ink_enabled,
      url: settings.webhook_low_ink_url,
      secret: settings.webhook_low_ink_secret,
    },
    'inventory.low_materials': {
      enabled: settings.webhook_low_materials_enabled,
      url: settings.webhook_low_materials_url,
      secret: settings.webhook_low_materials_secret,
    },
  };
  const t = map[event];
  if(!t || !t.enabled || !t.url) return null;
  return {url: t.url, secret: t.secret || ''};
}

/**
 * Send webhook with optional HMAC signature in `X-Webhook-Signature`.
 * Body is JSON. Returns {ok:boolean, status:number, text?:string}.
 */
async function postWebhook({url, secret, body}){
  const payload = JSON.stringify(body);
  let headers = {'Content-Type':'application/json'};
  if (secret) {
    // Simple HMAC SHA-256 signature (hex)
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const sigHex = Array.from(new Uint8Array(sigBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
    headers['X-Webhook-Signature'] = `sha256=${sigHex}`;
  }
  const res = await fetch(url, {method:'POST', headers, body: payload});
  const text = await res.text().catch(()=> '');
  return {ok:res.ok, status:res.status, text};
}

/**
 * Public helpers you call from app flows
 * Each loads settings row, resolves endpoint, expands customer,
 * and posts a structured payload.
 */

export async function webhookQuoteCreated(tenantId, quote){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'quote.created');
  if(!target) return;

  const customer = await getCustomer(tenantId, quote.customer_id);
  const body = {
    event: 'quote.created',
    tenant_id: tenantId,
    quote,
    customer,
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

export async function webhookQuoteToJob(tenantId, {quote, job}){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'quote.to_job');
  if(!target) return;

  const customer = await getCustomer(tenantId, job.customer_id || quote.customer_id);
  const body = {
    event: 'quote.to_job',
    tenant_id: tenantId,
    quote,
    job,
    customer,
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

export async function webhookJobCompleted(tenantId, job){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'job.completed');
  if(!target) return;

  const customer = await getCustomer(tenantId, job.customer_id);
  const body = {
    event: 'job.completed',
    tenant_id: tenantId,
    job,
    customer,
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

export async function webhookInvoiceGenerated(tenantId, invoice){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'invoice.generated');
  if(!target) return;

  const customer = await getCustomer(tenantId, invoice.customer_id);
  const body = {
    event: 'invoice.generated',
    tenant_id: tenantId,
    invoice,
    customer,
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

export async function webhookLowInk(tenantId, equipment, levels){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'inventory.low_ink');
  if(!target) return;

  const body = {
    event: 'inventory.low_ink',
    tenant_id: tenantId,
    equipment: { id: equipment.id, name: equipment.name, type: equipment.type },
    levels, // e.g. {c:12, m:3, ...}
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

export async function webhookLowMaterials(tenantId, materials){
  const settings = await getSettings(tenantId);
  const target = resolveTarget(settings, 'inventory.low_materials');
  if(!target) return;

  const body = {
    event: 'inventory.low_materials',
    tenant_id: tenantId,
    materials, // array of {id,name,on_hand,reorder_threshold,...}
    emitted_at: new Date().toISOString()
  };
  await postWebhook({url:target.url, secret:target.secret, body});
}

/** ---- helpers ---- */
async function getSettings(tenantId){
  const {data} = await supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
  return data || {};
}
async function getCustomer(tenantId, customerId){
  if(!customerId) return null;
  const {data} = await supabase.from('customers')
    .select('id,name,company,email,phone')
    .eq('tenant_id', tenantId).eq('id', customerId).maybeSingle();
  return data || null;
}
