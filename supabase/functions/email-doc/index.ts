// supabase/functions/email-doc/index.ts
// Sends transactional email with optional PDF attachments (fetched from signed URLs)
// Fixes: CORS in local & prod, and infinite recursion / stack overflow in attachment fetch

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type AttachmentIn = { filename: string; url: string };
type BodyIn = {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: AttachmentIn[];
  // optional plain text fallback
  text?: string;
};

const ALLOW_ORIGIN = "*"; // dev-friendly. You can restrict to your domain later.

Deno.serve(async (req) => {
  // --- CORS preflight ---
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return json({ error: "Expected JSON body" }, 415);
    }

    const payload = (await req.json()) as BodyIn;

    // Basic validation
    if (!payload?.to || !payload?.subject || !payload?.html) {
      return json({ error: "Missing to/subject/html" }, 400);
    }

    // Build attachments: fetch each URL and convert to base64
    const atts =
      (payload.attachments || []).length === 0
        ? []
        : await Promise.all(
            (payload.attachments || []).map(async (a) => {
              const { base64, mimeType } = await fetchAttachmentAsBase64(a.url);
              return {
                content: base64,
                filename: a.filename || "attachment",
                type: mimeType || "application/octet-stream",
                disposition: "attachment",
              };
            })
          );

    // Use Resend (or Nodemailer or Mailgun—swap here). This example uses Resend.
    // Make sure RESEND_API_KEY is set in the project/Function secrets.
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ error: "RESEND_API_KEY not set" }, 500);

    const to = Array.isArray(payload.to) ? payload.to : [payload.to];
    const body = {
      from: Deno.env.get("MAIL_FROM") || "noreply@app.3dlounge.ca",
      to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || undefined,
      attachments: atts,
    };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Resend error", data);
      return json({ error: "Email send failed", details: data }, 502);
    }

    return json({ ok: true, id: data?.id ?? null });
  } catch (err) {
    console.error(err);
    return json({ error: String(err?.message || err) }, 500);
  }
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
    },
  });
}

async function fetchAttachmentAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  // NOTE: This function **never calls itself** (previous recursion bug → call stack overflow).
  // It simply fetches the URL and converts ArrayBuffer -> base64.
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Attachment fetch failed: ${res.status} ${res.statusText}`);

  const mimeType = res.headers.get("content-type") || "application/octet-stream";
  const buf = await res.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  return { base64, mimeType };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Efficient, no recursion, no large string concatenations in a loop
  // Convert via Uint8Array -> binary string -> btoa
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  // deno-lint-ignore no-deprecated-deno-api
  return btoa(binary);
}
