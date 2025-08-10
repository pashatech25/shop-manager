// src/features/purchasing/api.js
import {supabase} from "../../lib/superbase.js";

/** Group low stock materials by vendor: { [vendor_id]: Material[] } */
export async function fetchLowItemsGrouped(tenantId){
  const {data, error} = await supabase
    .from("materials")
    .select("id,name,vendor_id,on_hand,reserved,reorder_threshold,purchase_price")
    .eq("tenant_id", tenantId);

  if(error) throw error;
  const byVendor = {};
  (data||[]).forEach(m=>{
    const onHand = Number(m.on_hand||0);
    const reserved = Number(m.reserved||0);
    const threshold = Number(m.reorder_threshold||0);
    const need = threshold - (onHand - reserved);
    if(need>0){
      const key = m.vendor_id || "unassigned";
      if(!byVendor[key]) byVendor[key]=[];
      byVendor[key].push(m);
    }
  });
  return byVendor;
}

/** Return a map of vendor_id -> {id,name,email,phone,...} */
export async function fetchVendorsMap(tenantId){
  const {data, error} = await supabase
    .from("vendors")
    .select("id,name,email,phone")
    .eq("tenant_id", tenantId)
    .order("name");
  if(error) throw error;
  const map={};
  (data||[]).forEach(v=>{ map[v.id]=v; });
  return map;
}

/** Create a PO with items (also generates a code via RPC if available). Returns created PO row. */
export async function createPOWithItems({tenantId, vendor, items}){
  // Allocate a code via RPC if you created it for 'po'. Fallback to timestamp.
  let code = `PO-${new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14)}`;
  const {data:codeRow, error:codeErr} = await supabase.rpc("allocate_code", {p_kind:"po", p_tenant_id:tenantId}).single();
  if(!codeErr && codeRow?.code){ code = codeRow.code; }

  const insertBody = {tenant_id: tenantId, vendor_id: vendor?.id ?? null, status:"open", code};
  const {data:po, error:poErr} = await supabase
    .from("purchase_orders")
    .insert(insertBody)
    .select("*")
    .single();
  if(poErr) throw poErr;

  // Insert items into purchase_order_items
  const rows = (items||[]).map(it=>({
    tenant_id: tenantId,
    po_id: po.id,
    material_id: it.material_id,
    description: it.description ?? null,
    qty: Number(it.qty||0),
    unit_cost: it.unit_cost!=null ? Number(it.unit_cost) : null
  })).filter(r=>r.material_id && r.qty>0);

  if(rows.length){
    const {error:itErr} = await supabase.from("purchase_order_items").insert(rows);
    if(itErr) throw itErr;
  }
  return po;
}

/** List POs for tenant (latest first) */
export async function listPOs(tenantId){
  const {data, error} = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at",{ascending:false});
  if(error) throw error;
  return data||[];
}

/** List PO items for a given PO (joins not required for now) */
export async function listPOItems(tenantId, poId){
  const {data, error} = await supabase
    .from("purchase_order_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("po_id", poId)
    .order("id");
  if(error) throw error;
  return data||[];
}

/** Set status to 'sent' */
export async function markPOSent(poId){
  const {error} = await supabase
    .from("purchase_orders")
    .update({status:"sent"})
    .eq("id", poId);
  if(error) throw error;
}

/**
 * Receive PO:
 *  - increments materials.on_hand
 *  - writes inventory_ledger entries
 *  - sets purchase_orders.status='received'
 */
export async function receivePO(poId){
  // Fetch PO + items (need tenant_id for each row)
  const {data:po, error:poErr} = await supabase.from("purchase_orders").select("*").eq("id", poId).single();
  if(poErr) throw poErr;
  const tenantId = po.tenant_id;

  const items = await listPOItems(tenantId, poId);

  // Update materials and create ledger entries (client-side loop; fine for small lists)
  for(const it of items){
    if(!it.material_id || !it.qty) continue;

    // increment on_hand
    const {data:matRow, error:selErr} = await supabase
      .from("materials")
      .select("on_hand")
      .eq("id", it.material_id)
      .eq("tenant_id", tenantId)
      .single();
    if(selErr) throw selErr;

    const newOnHand = Number(matRow?.on_hand||0) + Number(it.qty||0);
    const {error:updErr} = await supabase
      .from("materials")
      .update({on_hand: newOnHand})
      .eq("id", it.material_id)
      .eq("tenant_id", tenantId);
    if(updErr) throw updErr;

    // ledger
    const ledgerRow = {
      tenant_id: tenantId,
      material_id: it.material_id,
      qty_delta: Number(it.qty||0),
      reason: "purchase",
      ref_type: "po",
      ref_id: poId
    };
    const {error:ledErr} = await supabase.from("inventory_ledger").insert(ledgerRow);
    if(ledErr) throw ledErr;
  }

  const {error} = await supabase.from("purchase_orders").update({status:"received"}).eq("id", poId);
  if(error) throw error;
}

/** Save path to stored/generated PDF (for listing) */
export async function savePOPdfPath(poId, path){
  const {error} = await supabase.from("purchase_orders").update({pdf_path: path}).eq("id", poId);
  if(error) throw error;
}
