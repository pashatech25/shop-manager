// supabase/functions/email-doc/index.ts
// deno run --allow-net --allow-env --allow-read
import { Resend } from "https://esm.sh/resend@2.0.0";

type AttachmentRef = { filename: string; url: string };

function cors(res: Response) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  try {
    const { to, subject, html, attachments }: {
      to?: string;
      subject?: string;
      html?: string;
      attachments?: AttachmentRef[];
    } = await req.json().catch(() => ({} as any));

    if (!to || !subject || !html) {
      return cors(new Response(JSON.stringify({ error: "Missing 'to', 'subject' or 'html'." }), { status: 400 }));
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("FROM_EMAIL") || "noreply@example.com";
    if (!apiKey) {
      console.error("Missing RESEND_API_KEY secret");
      return cors(new Response(JSON.stringify({ error: "Misconfigured server (missing RESEND_API_KEY)" }), { status: 500 }));
    }

    const resend = new Resend(apiKey);

    // Fetch attachments (if any) and convert to Resend format
    let atts: Array<{ filename: string; content: Uint8Array }> | undefined;
    if (Array.isArray(attachments) && attachments.length) {
      atts = [];
      for (const a of attachments) {
        if (!a?.url || !a?.filename) continue;
        const r = await fetch(a.url);
        if (!r.ok) {
          console.warn("Attachment fetch failed:", a.url, r.status);
          continue;
        }
        const buf = new Uint8Array(await r.arrayBuffer());
        atts.push({ filename: a.filename, content: buf });
      }
    }

    const sendResult = await resend.emails.send({
      from,
      to,
      subject,
      html,
      // If you want a plain-text fallback:
      // text: html.replace(/<[^>]+>/g, " "),
      attachments: atts,
    });

    if ((sendResult as any)?.error) {
      console.error("Resend error:", (sendResult as any).error);
      return cors(new Response(JSON.stringify({ error: "Resend failed", details: (sendResult as any).error }), { status: 500 }));
    }

    return cors(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  } catch (err) {
    console.error("email-doc unhandled error:", err);
    return cors(new Response(JSON.stringify({ error: "Unhandled error", details: String(err?.message || err) }), { status: 500 }));
  }
});
