// supabase/functions/connect-callback/index.ts
// Deno Deploy / Edge runtime
import "jsr:@supabase/functions-js/edge-runtime";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.22.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_CLIENT_ID = Deno.env.get("STRIPE_CLIENT_ID")!; // from Stripe Connect (public)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // we send tenant_id in state

    if (!code || !state) {
      return new Response("Missing code/state", { status: 400, headers: corsHeaders });
    }

    // Exchange code -> account
    const tokenResp = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_secret: STRIPE_SECRET_KEY,
        client_id: STRIPE_CLIENT_ID,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      return new Response("OAuth exchange failed: " + t, { status: 400, headers: corsHeaders });
    }
    const tokenJson = await tokenResp.json();
    const connectedAccountId = tokenJson.stripe_user_id as string;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Save on settings row for this tenant
    const { error } = await supabase
      .from("settings")
      .update({
        stripe_connected_account_id: connectedAccountId,
        stripe_connect_status: "connected",
        stripe_connect_info: tokenJson,
      })
      .eq("tenant_id", state);

    if (error) {
      return new Response("Failed to save Stripe connect info: " + error.message, { status: 500, headers: corsHeaders });
    }

    // redirect back to your app Settings
    const redirect = new URL("/settings", url.origin);
    // If your app is on different domain locally, change this to http://localhost:5173/settings
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: redirect.toString() } });
  } catch (e) {
    return new Response("Error: " + e.message, { status: 500, headers: corsHeaders });
  }
});
