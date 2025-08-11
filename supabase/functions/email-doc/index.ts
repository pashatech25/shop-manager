// supabase/functions/email-doc/index.ts
// Deno Edge Function — send email via Resend
// Body: { to: string, subject: string, html: string, attachments?: [{ filename: string, url: string }] }

type Attachment = { filename: string; url: string };
type Payload = {
  to?: string;
  subject?: string;
  html?: string;
  attachments?: Attachment[];
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL");

    if (!RESEND_API_KEY || !FROM_EMAIL) {
      return json(
        { error: "Missing secrets RESEND_API_KEY or FROM_EMAIL" },
        500,
      );
    }

    const body = (await req.json()) as Payload;
    const to = body?.to?.trim();
    const subject = body?.subject?.trim();
    const html = body?.html ?? "";
    const rawAttachments = Array.isArray(body?.attachments)
      ? body!.attachments!
      : [];

    if (!to || !subject || !html) {
      return json({ error: "to, subject, and html are required" }, 400);
    }

    // Resend accepts {path} (URL) or {content}; we pass signed URLs as paths.
    const attachments = rawAttachments
      .filter((a) => a?.filename && a?.url)
      .map((a) => ({ filename: a.filename, path: a.url }));

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,      // e.g. 'Billing <noreply@yourdomain.com>'
        to: [to],
        subject,
        html,
        attachments: attachments.length ? attachments : undefined,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Resend error:", data);
      return json({ error: "Resend failed", details: data }, r.status);
    }

    return json({ ok: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("email-doc error:", err);
    return json({ error: msg }, 500);
  }
});
