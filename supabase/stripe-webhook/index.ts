// supabase/functions/stripe-webhook/index.ts
import "jsr:@supabase/functions-js/edge-runtime";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing Stripe signature", { status: 400, headers: corsHeaders });

  try {
    const raw = await req.text();
    const event = stripe.webhooks.constructEvent(raw, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const tenant_id = session.metadata?.tenant_id;
      const invoice_id = session.metadata?.invoice_id;
      const payment_intent = session.payment_intent;

      if (tenant_id && invoice_id) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        const amount_total = Number(session.amount_total ?? 0) / 100;
        const currency = (session.currency || "usd").toString().toUpperCase();

        // Mark invoice paid
        await supabase
          .from("invoices")
          .update({
            paid_at: new Date().toISOString(),
            paid_via: "stripe",
            payment_ref: String(payment_intent || session.id),
            payment_amount: amount_total
          })
          .eq("id", invoice_id)
          .eq("tenant_id", tenant_id);

        // Append payment history
        await supabase.from("payments").insert([{
          tenant_id,
          invoice_id,
          method: "stripe",
          status: "succeeded",
          amount: amount_total,
          currency,
          provider_ref: String(payment_intent || session.id),
          meta: { session_id: session.id, account: event.account || null }
        }]);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("Webhook error: " + e.message, { status: 400, headers: corsHeaders });
  }
});
