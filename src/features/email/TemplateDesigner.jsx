// src/features/email/TemplateDesigner.jsx
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/superbase.js";
import { renderTemplate } from "./templates.js";

/**
 * Minimal, dependency-free template builder.
 * Blocks: Header, Paragraph, Button, Image
 * Live preview (with sample variables)
 * Saves to public.settings.email_invoice_template_html / email_po_template_html
 */
export default function TemplateDesigner({
  tenantId,
  type, // "invoice" | "po"
  initialHtml,
  defaultHtml,
  variables = [],
  onSaved, // optional
}) {
  const [blocks, setBlocks] = useState(() =>
    initialHtml ? htmlToBlocks(initialHtml) : htmlToBlocks(defaultHtml)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBlocks(initialHtml ? htmlToBlocks(initialHtml) : htmlToBlocks(defaultHtml));
    // eslint-disable-next-line
  }, [initialHtml, defaultHtml, type]);

  const html = useMemo(() => blocksToHtml(blocks), [blocks]);
  const sampleVars = useMemo(() => {
    const samples = {};
    for (const v of variables) samples[v.name] = v.sample ?? v.name.toUpperCase();
    if (samples.logo_url && !samples.logo_url_display) samples.logo_url_display = "block";
    return samples;
  }, [variables]);

  async function save() {
    try {
      setSaving(true);
      const column =
        type === "invoice" ? "email_invoice_template_html" : "email_po_template_html";
      const { error } = await supabase
        .from("settings")
        .update({ [column]: html })
        .eq("tenant_id", tenantId);
      if (error) throw error;
      onSaved?.(html);
      alert("Template saved.");
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  function resetDefault() {
    setBlocks(htmlToBlocks(defaultHtml));
  }

  function addBlock(kind) {
    const base =
      kind === "header"
        ? { kind, text: "Your headline here" }
        : kind === "paragraph"
        ? { kind, text: "Write something nice." }
        : kind === "button"
        ? { kind, text: "Open PDF", href: "{{links.pdf_url}}" }
        : { kind, src: "{{assets.logo_url}}", alt: "Logo", height: 32 };
    setBlocks((b) => [...b, base]);
  }

  function move(i, dir) {
    setBlocks((b) => {
      const arr = b.slice();
      const j = i + dir;
      if (j < 0 || j >= arr.length) return b;
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      return arr;
    });
  }
  function remove(i) { setBlocks((b) => b.filter((_, idx) => idx !== i)); }
  function update(i, patch) {
    setBlocks((b) => b.map((blk, idx) => (idx === i ? { ...blk, ...patch } : blk)));
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* Controls */}
      <div>
        <div className="card" style={{ marginBottom: 12 }}>
          <b>Add block</b>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => addBlock("header")}>Header</button>
            <button className="btn" onClick={() => addBlock("paragraph")}>Paragraph</button>
            <button className="btn" onClick={() => addBlock("button")}>Button</button>
            <button className="btn" onClick={() => addBlock("image")}>Image</button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <b>Blocks</b>
          {blocks.length === 0 ? <div className="tiny">No blocks yet.</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blocks.map((blk, i) => (
              <div key={i} className="form-card" style={{ display: "grid", gap: 8 }}>
                <div className="row">
                  <span className="tiny mono">{blk.kind.toUpperCase()}</span>
                  <div className="btn-row">
                    <button className="btn" onClick={() => move(i, -1)}>↑</button>
                    <button className="btn" onClick={() => move(i, +1)}>↓</button>
                    <button className="btn btn-danger" onClick={() => remove(i)}>Remove</button>
                  </div>
                </div>

                {blk.kind === "header" && (
                  <input value={blk.text} onChange={(e) => update(i, { text: e.target.value })} />
                )}

                {blk.kind === "paragraph" && (
                  <textarea rows={3} value={blk.text} onChange={(e) => update(i, { text: e.target.value })} />
                )}

                {blk.kind === "button" && (
                  <>
                    <input placeholder="Button text" value={blk.text}
                           onChange={(e) => update(i, { text: e.target.value })}/>
                    <input placeholder="href (e.g. {{links.pdf_url}})" value={blk.href}
                           onChange={(e) => update(i, { href: e.target.value })}/>
                  </>
                )}

                {blk.kind === "image" && (
                  <>
                    <input placeholder="Image URL (e.g. {{assets.logo_url}})" value={blk.src}
                           onChange={(e) => update(i, { src: e.target.value })}/>
                    <input placeholder="Alt" value={blk.alt || ""}
                           onChange={(e) => update(i, { alt: e.target.value })}/>
                    <input placeholder="Height (px)" type="number" value={blk.height || 32}
                           onChange={(e) => update(i, { height: Number(e.target.value || 0) })}/>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={resetDefault}>Reset to default</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving..." : "Save Template"}
          </button>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <b>Available variables</b>
          <div className="tiny" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {variables.map((v) => (
              <span key={v.name} className="chip" title={v.sample || ""}>
                {`{{${v.name}}}`}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div className="card" style={{ background: "#f6f7f9" }}>
        <b>Preview</b>
        <div
          style={{ marginTop: 10, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}
          dangerouslySetInnerHTML={{ __html: renderTemplate(html, sampleVars) }}
        />
      </div>
    </div>
  );
}

// ————— Helpers ————— //

function blocksToHtml(blocks) {
  const parts = [];
  parts.push(`<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:24px"><div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,.06);overflow:hidden"><div style="padding:20px;border-bottom:1px solid #eee;display:flex;gap:12px;align-items:center"><img src="{{assets.logo_url}}" alt="" style="height:32px;display:{{assets.logo_url_display}}"><div style="font-weight:700;font-size:18px">{{business.name}}</div></div><div style="padding:20px">`);
  for (const blk of blocks) {
    if (blk.kind === "header") {
      parts.push(`<h2 style="margin:0 0 6px">${escapeHtml(blk.text || "")}</h2>`);
    } else if (blk.kind === "paragraph") {
      parts.push(`<p style="margin:0 0 12px">${escapeHtml(blk.text || "")}</p>`);
    } else if (blk.kind === "button") {
      const text = escapeHtml(blk.text || "Open");
      const href = escapeHtml(blk.href || "{{links.pdf_url}}");
      parts.push(`<div style="margin:12px 0"><a href="${href}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#111;color:#fff;text-decoration:none">${text}</a></div>`);
    } else if (blk.kind === "image") {
      const src = escapeHtml(blk.src || "{{assets.logo_url}}");
      const alt = escapeHtml(blk.alt || "");
      const h = blk.height || 32;
      parts.push(`<div style="margin:8px 0"><img src="${src}" alt="${alt}" style="height:${h}px"></div>`);
    }
  }
  parts.push(`</div><div style="padding:12px 20px;background:#fafafa;color:#777;font-size:12px;border-top:1px solid #eee">Sent by {{business.name}} • {{business.email}}</div></div></div>`);
  return parts.join("");
}

function htmlToBlocks(html) {
  if (!html || typeof html !== "string") return [];
  const blocks = [];

  const headerRe = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const btnRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const imgRe = /<img[^>]*src="([^"]+)"[^>]*[^>]*>/gi;

  let m;
  while ((m = headerRe.exec(html))) blocks.push({ kind: "header", text: stripTags(m[1]) });
  while ((m = pRe.exec(html))) blocks.push({ kind: "paragraph", text: stripTags(m[1]) });
  while ((m = btnRe.exec(html))) blocks.push({ kind: "button", href: m[1], text: stripTags(m[2]) });
  while ((m = imgRe.exec(html))) blocks.push({ kind: "image", src: m[1], alt: "", height: 32 });

  if (blocks.length === 0) {
    return [
      { kind: "header", text: "Hello {{customer.name}}{{vendor.name}}" },
      { kind: "paragraph", text: "Please find your document attached." },
      { kind: "button", text: "Open PDF", href: "{{links.pdf_url}}" }
    ];
  }
  return blocks;
}

function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
