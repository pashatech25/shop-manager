import { useEffect, useMemo, useRef, useState } from "react";
import { useTenant } from "../context/TenantContext.jsx";
import {
  fetchLowItemsGrouped,
  fetchVendorsMap,
  listVendors,
  listVendorMaterials,
  listActiveJobs,
  createPOWithItems,
  createPOManual,
  listPOs,
  listPOItems,
  markPOSent,
  receivePO,
  savePOPdfPath,
} from "../features/purchasing/api.js";
import Spinner from "../features/ui/Spinner.jsx";
import Confirm from "../features/ui/Confirm.jsx";
import { captureElementToPdf } from "../features/pdf/service.js";
import { supabase } from "../lib/superbase.js";
import { sendEmailDoc } from "../lib/email.js";

// NEW: templates
import { renderTemplate, poDefaults, buildPOContext } from "../features/email/templates.js";

export default function PurchaseOrders() {
  const { tenantId } = useTenant();
  const [loading, setLoading] = useState(true);

  // summary cards + listing
  const [lowByVendor, setLowByVendor] = useState({});
  const [vendorsMap, setVendorsMap] = useState({});
  const [pos, setPOs] = useState([]);

  // modals
  const [viewPO, setViewPO] = useState(null);
  const [poItems, setPOItems] = useState([]);
  const [emailFor, setEmailFor] = useState(null);
  const printRef = useRef(null);

  // PDF preview modal state
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState("");

  // New PO form
  const [showNew, setShowNew] = useState(false);

  // Low-by-vendor modal
  const [lowModal, setLowModal] = useState(null); // { vendorId, items: [...] }

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const [low, vm, pl] = await Promise.all([
      fetchLowItemsGrouped(tenantId),
      fetchVendorsMap(tenantId),
      listPOs(tenantId),
    ]);
    setLowByVendor(low);
    setVendorsMap(vm);
    setPOs(pl);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tenantId]);

  // --------- actions ----------
  const openPO = async (po) => {
    setViewPO(po);
    const items = await listPOItems(tenantId, po.id);
    setPOItems(items);
  };

  const doReceive = async (po) => {
    if (!confirm("Mark as received and update inventory?")) return;
    await receivePO(po.id);
    alert("PO received and inventory updated.");
    await load();
  };

  // generate + preview PDF
  const generatePdf = async (po) => {
    try {
      const el = printRef.current;
      if (!el) {
        alert("Printable element not found");
        return;
      }
      el.innerHTML = renderPOHtml({
        po,
        vendor: vendorsMap[po.vendor_id] || {},
        items: poItems,
      });

      const { path, url } = await captureElementToPdf({
        element: el,
        tenantId,
        kind: "purchase-orders",
        code: po.code,
      });

      await savePOPdfPath(po.id, path);
      setPdfPreviewUrl(url);
      await load();
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to generate PDF");
    }
  };

  // open a signed URL for the saved PDF (download/open)
  const openSignedPdf = async (po) => {
    try {
      if (!po?.pdf_path) return alert("No PDF saved yet. Click PDF to generate.");
      const { data, error } = await supabase
        .storage
        .from("pdfs")
        .createSignedUrl(po.pdf_path, 60 * 10);
      if (error) throw error;

      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = `${po.code}.pdf`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to open PDF");
    }
  };

  // email sender — prefill vendor email, allow override (uses templates)
  // sendEmail(po, to) — call this from your Confirm modal "Yes"
const sendEmail = async (po, to) => {
  try {
    // 1) Load vendor (so we can prefill/ctx vendor info)
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id,name,email,phone,address")
      .eq("id", po.vendor_id)
      .maybeSingle();

    // 2) Load settings (may include custom PO subject/html)
    const { data: settings } = await supabase
      .from("settings")
      .select("business_name,business_email,brand_logo_url,brand_logo_path,email_po_subject,email_po_template_html,currency")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    // 3) Signed PDF URL (if you stored one)
    let pdfUrl = "";
    if (po.pdf_path) {
      const { data: signed } = await supabase
        .storage
        .from("pdfs")
        .createSignedUrl(po.pdf_path, 60 * 60);
      if (signed?.signedUrl) pdfUrl = signed.signedUrl;
    }

    // 4) Load items for context (your listPOItems already exists)
    const items = await listPOItems(tenantId, po.id);

    // 5) Pick template strings (custom or defaults)
    const dft     = poDefaults(); // { subject, html }
    const subjTpl = settings?.email_po_subject || dft.subject;
    const htmlTpl = settings?.email_po_template_html || dft.html;

    // 6) Build PO context & render
    const ctx = buildPOContext({ po, vendor, settings, items, pdfUrl });
    const subject = renderTemplate(subjTpl, ctx);
    const html    = renderTemplate(htmlTpl, ctx);

    // 7) Optional attachment
    const attachments = pdfUrl ? [{ filename: `${po.code}.pdf`, url: pdfUrl }] : undefined;

    await sendEmailDoc({ to, subject, html, attachments });
    alert("Email sent.");
    setEmailFor(null); // if you keep that modal state
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to send email");
  }
};

  return (
    <section className="section">
      <div className="section-header">
        <h2>Purchase Orders</h2>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <i className="fa-solid fa-plus" /> New Purchase Order
          </button>
          {loading ? <Spinner label="Loading" /> : null}
        </div>
      </div>

      {/* New PO Form */}
      {showNew ? (
        <NewPOForm
          tenantId={tenantId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      ) : null}

      {/* Low Inventory by Vendor */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <h3 className="tiny m-0">Low Inventory by Vendor</h3>
          <span className="tiny">Select items and quantities to create a PO</span>
        </div>
        {Object.keys(lowByVendor).length === 0 ? (
          <div className="tiny">No low items.</div>
        ) : null}
        <div className="cards">
          {Object.entries(lowByVendor).map(([vendorId, items]) => {
            const v = vendorsMap[vendorId] || { name: "(Unknown)" };
            return (
              <div key={vendorId} className="card">
                <div className="row" style={{ alignItems: "center" }}>
                  <b>{v.name}</b>
                  <div className="btn-row">
                    <button
                      className="btn"
                      onClick={() => setLowModal({ vendorId, items })}
                    >
                      Select & Create
                    </button>
                  </div>
                </div>
                <ul style={{ margin: "8px 0 0 18px" }}>
                  {items.map((m) => (
                    <li key={m.id}>
                      {m.name}{" "}
                      <span className="tiny">
                        on hand {m.on_hand ?? 0}, reserved {m.reserved ?? 0},
                        threshold {m.reorder_threshold ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* PO list */}
      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>PDF</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(pos || []).map((po) => (
              <tr key={po.id}>
                <td className="mono">{po.code}</td>
                <td>{vendorsMap[po.vendor_id]?.name || "—"}</td>
                <td>
                  <span className="badge">{po.status}</span>
                </td>
                <td>
                  {po.pdf_path ? (
                    <button className="btn" onClick={() => openSignedPdf(po)}>
                      Download
                    </button>
                  ) : (
                    <span className="tiny">—</span>
                  )}
                </td>
                <td style={{ textAlign: "right" }}>
                  <div className="btn-row" style={{ justifyContent: "flex-end" }}>
                    <button className="btn" onClick={() => openPO(po)}>
                      View
                    </button>
                    {po.status === "open" ? (
                      <button className="btn" onClick={() => markPOSent(po.id).then(load)}>
                        Mark Sent
                      </button>
                    ) : null}
                    {po.status !== "received" ? (
                      <button className="btn btn-primary" onClick={() => doReceive(po)}>
                        Receive
                      </button>
                    ) : null}
                    <button className="btn" onClick={() => openPO(po)}>
                      <i className="fa-regular fa-file-pdf" /> PDF
                    </button>
                    <button className="btn" onClick={() => setEmailFor(po)}>
                      <i className="fa-regular fa-envelope" /> Email
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && pos.length === 0 ? (
              <tr>
                <td colSpan={5} className="tiny">
                  No POs yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* View PO modal */}
      {viewPO ? (
        <POModal
          po={viewPO}
          onClose={() => setViewPO(null)}
          onReady={(items) => setPOItems(items)}
          onPdf={() => generatePdf(viewPO)}
        />
      ) : null}

      {/* Low-by-vendor modal */}
      {lowModal ? (
        <LowVendorModal
          tenantId={tenantId}
          vendor={vendorsMap[lowModal.vendorId] || { id: lowModal.vendorId, name: "(Unknown)" }}
          items={lowModal.items}
          onClose={() => setLowModal(null)}
          onCreate={async (picked) => {
            if (!picked.length) return alert("Select at least one item");
            const po = await createPOWithItems({
              tenantId,
              vendor: { id: lowModal.vendorId },
              items: picked.map((p) => ({
                material_id: p.id,
                description: p.name,
                qty: Number(p.qty || 1),
                unit_cost: p.purchase_price ?? null,
              })),
            });
            alert(`PO created: ${po.code}`);
            setLowModal(null);
            await load();
          }}
        />
      ) : null}

      {/* Hidden print region for html2canvas */}
      <div ref={printRef} style={{ position: "fixed", left: -9999, top: -9999 }} />

      {/* Email confirm (prefill vendor email, can override) */}
      <Confirm
        open={!!emailFor}
        title={`Email ${emailFor?.code}`}
        message={
          <span>
            <label className="tiny">Recipient</label>
            <input
              id="pomail"
              type="email"
              placeholder="name@vendor.com"
              style={{ width: "100%" }}
              defaultValue={emailFor ? (vendorsMap[emailFor.vendor_id]?.email || "") : ""}
            />
          </span>
        }
        onYes={() => {
          const to = document.getElementById("pomail")?.value?.trim();
          if (!to) return alert("Enter an email");
          sendEmail(emailFor, to);
        }}
        onNo={() => setEmailFor(null)}
      />

      {/* PDF Preview Modal */}
      {pdfPreviewUrl ? (
        <div className="modal" onClick={() => setPdfPreviewUrl("")}>
          <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <h3 className="m-0">Purchase Order PDF</h3>
              <div className="btn-row">
                <a className="btn" href={pdfPreviewUrl} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
                <button className="btn btn-secondary" onClick={() => setPdfPreviewUrl("")}>
                  Close
                </button>
              </div>
            </div>
            <div style={{ height: "75vh", border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
              <iframe
                title="PO PDF Preview"
                src={pdfPreviewUrl}
                style={{ width: "100%", height: "100%", border: "0" }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** New PO form (manual) */
function NewPOForm({ tenantId, onClose, onCreated }) {
  const [vendors, setVendors] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [vendorId, setVendorId] = useState("");
  const [materials, setMaterials] = useState([]);
  const [checked, setChecked] = useState({}); // material_id -> true/false
  const [qtyById, setQtyById] = useState({}); // material_id -> qty
  const [jobId, setJobId] = useState("");

  const loading = useMemo(
    () => !vendors.length && !materials.length,
    [vendors, materials]
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [vs, js] = await Promise.all([
        listVendors(tenantId),
        listActiveJobs(tenantId),
      ]);
      if (cancel) return;
      setVendors(vs);
      setJobs(js);
    })();
    return () => (cancel = true);
  }, [tenantId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!vendorId) {
        setMaterials([]);
        setChecked({});
        setQtyById({});
        return;
      }
      const mats = await listVendorMaterials(tenantId, vendorId);
      if (cancel) return;
      setMaterials(mats);
      // prefill qty 1 when selecting vendor
      const q = {};
      const c = {};
      mats.forEach((m) => {
        q[m.id] = 1;
        c[m.id] = false;
      });
      setQtyById(q);
      setChecked(c);
    })();
    return () => (cancel = true);
  }, [tenantId, vendorId]);

  const pickAll = (val) => {
    const c = {};
    materials.forEach((m) => (c[m.id] = val));
    setChecked(c);
  };

  const create = async () => {
    if (!vendorId) return alert("Select vendor");
    const items = materials
      .filter((m) => checked[m.id])
      .map((m) => ({
        material_id: m.id,
        description: m.name,
        qty: Number(qtyById[m.id] || 0),
        unit_cost: m.purchase_price ?? null,
      }))
      .filter((it) => it.qty > 0);
    if (!items.length) return alert("Pick at least one material with qty > 0");

    const po = await createPOManual({
      tenantId,
      vendorId,
      jobId: jobId || null,
      items,
    });
    alert(`PO created: ${po.code}`);
    onCreated?.(po);
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="section-header">
        <h3 className="m-0">New Purchase Order</h3>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={create}>
            Create PO
          </button>
        </div>
      </div>

      <div className="grid-3">
        <div className="group">
          <label>Vendor</label>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div className="group">
          <label>Link to Job (optional)</label>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">— none —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.code} — {j.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!vendorId ? (
        <div className="tiny" style={{ marginTop: 10 }}>
          Select a vendor to see their materials.
        </div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="btn-row">
              <button className="btn" onClick={() => pickAll(true)}>
                Select All
              </button>
              <button className="btn" onClick={() => pickAll(false)}>
                Clear
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Material</th>
                <th style={{ width: 140, textAlign: "right" }}>Qty</th>
                <th style={{ width: 160, textAlign: "right" }}>Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => (
                <tr key={m.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!checked[m.id]}
                      onChange={(e) =>
                        setChecked((c) => ({ ...c, [m.id]: e.target.checked }))
                      }
                    />
                  </td>
                  <td>
                    {m.name} <span className="tiny">on hand {m.on_hand ?? 0}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={qtyById[m.id] ?? 0}
                      onChange={(e) =>
                        setQtyById((q) => ({ ...q, [m.id]: e.target.value }))
                      }
                      style={{ width: 120 }}
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {m.purchase_price != null
                      ? `$${Number(m.purchase_price).toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={4} className="tiny">
                    No materials for this vendor.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Low-inventory modal: pick materials + quantities before creating */
function LowVendorModal({ tenantId, vendor, items, onClose, onCreate }) {
  const [checked, setChecked] = useState({});
  const [qtyById, setQtyById] = useState({});

  useEffect(() => {
    const c = {};
    const q = {};
    (items || []).forEach((m) => {
      c[m.id] = true; // precheck low items
      const need = Math.max(
        1,
        Number(m.reorder_threshold || 0) -
          (Number(m.on_hand || 0) - Number(m.reserved || 0))
      );
      q[m.id] = need;
    });
    setChecked(c);
    setQtyById(q);
  }, [items]);

  const pickAll = (val) => {
    const c = {};
    (items || []).forEach((m) => (c[m.id] = val));
    setChecked(c);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="m-0">Create PO — {vendor.name}</h3>
          <div className="btn-row">
            <button className="btn" onClick={() => pickAll(true)}>
              Select All
            </button>
            <button className="btn" onClick={() => pickAll(false)}>
              Clear
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const picked = (items || [])
                  .filter((m) => checked[m.id])
                  .map((m) => ({
                    ...m,
                    qty: Number(qtyById[m.id] || 0),
                  }))
                  .filter((m) => m.qty > 0);
                onCreate?.(picked);
              }}
            >
              Create PO
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>Material</th>
                <th style={{ textAlign: "right", width: 120 }}>Need / Qty</th>
                <th style={{ textAlign: "right", width: 140 }}>Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {(items || []).map((m) => {
                const need = Math.max(
                  1,
                  Number(m.reorder_threshold || 0) -
                    (Number(m.on_hand || 0) - Number(m.reserved || 0))
                );
                return (
                  <tr key={m.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!checked[m.id]}
                        onChange={(e) =>
                          setChecked((c) => ({
                            ...c,
                            [m.id]: e.target.checked,
                          }))
                        }
                      />
                    </td>
                    <td>{m.name}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={qtyById[m.id] ?? need}
                        onChange={(e) =>
                          setQtyById((q) => ({ ...q, [m.id]: e.target.value }))
                        }
                        style={{ width: 100 }}
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {m.purchase_price != null
                        ? `$${Number(m.purchase_price).toFixed(2)}`
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {!items?.length ? (
                <tr>
                  <td colSpan={4} className="tiny">
                    No items.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function POModal({ po, onClose, onReady, onPdf }) {
  const { tenantId } = useTenant();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const rows = await listPOItems(tenantId, po.id);
      setItems(rows);
      setLoading(false);
      onReady?.(rows);
    };
    load();
  }, [tenantId, po.id]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>
            PO <span className="tiny mono">{po.code}</span>
          </h3>
          <div className="btn-row">
            <button className="btn" onClick={onPdf}>
              <i className="fa-regular fa-file-pdf" /> PDF
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        {loading ? (
          <Spinner label="Loading items" />
        ) : (
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.description}</td>
                  <td>{it.qty}</td>
                  <td>
                    {it.unit_cost != null
                      ? `$${Number(it.unit_cost).toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function renderPOHtml({ po, vendor, items }) {
  return `
  <div style="font-family:Arial, sans-serif; padding:24px; width:800px;">
    <div style="display:flex; justify-content:space-between;">
      <div><h2 style="margin:0 0 6px 0;">Purchase Order</h2><div class="mono"># ${po.code}</div></div>
      <div style="text-align:right">
        <div style="font-size:14px">${vendor.name || ""}</div>
      </div>
    </div>
    <div style="margin:12px 0; height:1px; background:#eee;"></div>
    <table style="width:100%; font-size:14px; border-collapse:collapse;">
      <thead><tr><th align="left">Description</th><th align="right">Qty</th><th align="right">Unit Cost</th></tr></thead>
      <tbody>
        ${(items||[]).map(it=>`
          <tr>
            <td>${escapeHtml(it.description||'')}</td>
            <td align="right">${Number(it.qty||0)}</td>
            <td align="right">${it.unit_cost!=null? '$'+Number(it.unit_cost).toFixed(2) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>`;
}

function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
