// supabase/functions/create-checkout-session/index.ts
import "jsr:@supabase/functions-js/edge-runtime";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!; // verify JWT
const stripeRoot = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return new Response("Missing auth", { status: 401, headers: corsHeaders });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const body = await req.json().catch(() => ({}));
    const { invoice_id, success_url, cancel_url } = body;
    if (!invoice_id) return new Response("Missing invoice_id", { status: 400, headers: corsHeaders });

    // Load invoice + tenant id
    const { data: inv, error: invErr } = await supabase
      .from("invoices")
      .select("id, tenant_id, code, totals, customer_id, deposit_amount, discount_type, discount_value, discount_apply_tax")
      .eq("id", invoice_id)
      .single();
    if (invErr || !inv) return new Response("Invoice not found", { status: 404, headers: corsHeaders });

    const { data: settings } = await supabase
      .from("settings")
      .select("stripe_connected_account_id, currency")
      .eq("tenant_id", inv.tenant_id)
      .single();

    const account = settings?.stripe_connected_account_id;
    if (!account) return new Response("Stripe not connected for tenant", { status: 400, headers: corsHeaders });

    // Compute final due = totals.grand - deposit
    const grand = Number(inv.totals?.grand ?? 0);
    const deposit = Number(inv.deposit_amount ?? inv.totals?.deposit ?? 0);
    const due = Math.max(0, grand - deposit);
    const currency = (settings?.currency || "USD").toString().toLowerCase();

    // Create session using account header
    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      httpClient: Stripe.createFetchHttpClient(),
      stripeAccount: account,
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: success_url || "https://example.com/success",
      cancel_url: cancel_url || "https://example.com/cancel",
      metadata: {
        tenant_id: inv.tenant_id,
        invoice_id: inv.id,
        invoice_code: inv.code,
      },
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(due * 100),
          product_data: { name: `Invoice ${inv.code}` },
        }
      }]
    });

    return new Response(JSON.stringify({ url: session.url, id: session.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500, headers: corsHeaders });
  }
});
