import React, {useEffect, useMemo, useState} from "react";
import {useTenant} from "../../context/TenantContext.jsx";
import {supabase} from "../../lib/superbase.js";

// helpers to rebuild charges when needed
async function loadPriceMaps(tenantId){
  const [mats, equips] = await Promise.all([
    supabase.from("materials").select("id,selling_price").eq("tenant_id", tenantId),
    supabase.from("equipments").select("id,rate_c,rate_m,rate_y,rate_k,rate_white,rate_soft_white,rate_gloss").eq("tenant_id", tenantId)
  ]);
  const matMap = new Map((mats.data||[]).map(r=>[r.id, Number(r.selling_price||0)]));
  const eqMap  = new Map((equips.data||[]).map(r=>[r.id, {
    c:+(r.rate_c||0), m:+(r.rate_m||0), y:+(r.rate_y||0), k:+(r.rate_k||0),
    white:+(r.rate_white||0), soft_white:+(r.rate_soft_white||0), gloss:+(r.rate_gloss||0)
  }]));
  return {matMap, eqMap};
}
function recomputeChargesFromItems(items, {matMap, eqMap}, marginPct=100){
  const mats = Array.isArray(items?.materials)? items.materials: [];
  const eqs  = Array.isArray(items?.equipments)? items.equipments: [];
  const adds = Array.isArray(items?.addons)? items.addons: [];
  const labs = Array.isArray(items?.labor)? items.labor: [];

  let materialsCharge = 0;
  for(const l of mats){ materialsCharge += Number(l.qty||0) * (matMap.get(l.material_id)||0); }

  let equipmentCharge = 0, uvInkCost=0;
  for(const l of eqs){
    const type=(l.type||"").toLowerCase();
    const isUV = type.includes("uv") || type.includes("sublimation");
    if(!isUV){
      if(l.mode==="hourly") equipmentCharge += Number(l.hours||0) * Number(l.rate||0);
      else equipmentCharge += Number(l.flat_fee||0);
      continue;
    }
    const r = eqMap.get(l.equipment_id)||{};
    const ink=l.inks||{}; const sw=!!l.use_soft_white;
    uvInkCost += Number(ink.c||0)*(r.c||0)
               + Number(ink.m||0)*(r.m||0)
               + Number(ink.y||0)*(r.y||0)
               + Number(ink.k||0)*(r.k||0)
               + Number(ink.gloss||0)*(r.gloss||0)
               + (sw? Number(ink.soft_white||0)*(r.soft_white||0) : Number(ink.white||0)*(r.white||0));
  }
  const inkCharge = uvInkCost * (1 + Number(marginPct||0)/100);

  let laborCharge=0; for(const l of labs){ laborCharge += Number(l.hours||0)*Number(l.rate||0); }
  let addonsCharge=0; for(const a of adds){ addonsCharge += Number(a.qty||0)*Number(a.price||0); }

  const preTax = equipmentCharge + materialsCharge + laborCharge + addonsCharge + (isFinite(inkCharge)? inkCharge:0);
  return {equipmentCharge, materialsCharge, laborCharge, addonsCharge, inkCharge, preTax};
}

export default function Editor({row, onClose, onSaved}){
  const {tenantId}=useTenant();
  const [settings,setSettings]=useState(null);

  // persisted fields
  const [memo,setMemo]=useState(row?.memo||"");
  const [discountType,setDiscountType]=useState(row?.discount_type||"percent"); // "percent" | "flat"
  const [discountValue,setDiscountValue]=useState(row?.discount||0);
  const [deposit,setDeposit]=useState(row?.deposit||0);

  // totals JSON flags (we keep them in totals to avoid schema issues)
  const [showInkUsage,setShowInkUsage]=useState(!!(row?.totals?.showInkUsage));
  const [discountApplyTax,setDiscountApplyTax]=useState(!!(row?.totals?.discountApplyTax));

  const [effectiveTotals,setEffectiveTotals]=useState(row?.totals||{});
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let alive=true;
    (async ()=>{
      try{
        setLoading(true);
        const {data:st}=await supabase.from("settings").select("tax_rate,currency").eq("tenant_id", tenantId).maybeSingle();
        if(alive) setSettings(st||{tax_rate:0,currency:"USD"});

        // recompute fallback charges if needed
        const maps=await loadPriceMaps(tenantId);
        const marginPct=row?.items?.meta?.marginPct ?? 100;
        const f=recomputeChargesFromItems(row?.items, maps, marginPct);

        const merged={
          ...(row?.totals||{}),
          equipmentCharge: row?.totals?.equipmentCharge ?? f.equipmentCharge,
          materialsCharge: row?.totals?.materialsCharge ?? f.materialsCharge,
          laborCharge:     row?.totals?.laborCharge     ?? f.laborCharge,
          addonsCharge:    row?.totals?.addonsCharge    ?? f.addonsCharge,
          inkCharge:       row?.totals?.inkCharge       ?? f.inkCharge,
          totalChargePreTax: row?.totals?.totalChargePreTax ?? f.preTax,
          showInkUsage: !!(row?.totals?.showInkUsage) || false,
          discountApplyTax: !!(row?.totals?.discountApplyTax) || false
        };
        if(alive) setEffectiveTotals(merged);
        if(alive) setShowInkUsage(!!merged.showInkUsage);
        if(alive) setDiscountApplyTax(!!merged.discountApplyTax);
      }finally{
        if(alive) setLoading(false);
      }
    })();
    return ()=>{ alive=false; };
  },[tenantId, row?.id]);

  const calc = useMemo(()=>{
    const t=effectiveTotals||{};
    const pre = Number(t.totalChargePreTax||0);

    const discVal = Number(discountValue||0);
    const discountAmt = (discountType==="percent")? (pre * (discVal/100)) : discVal;

    const ratePct = Number(settings?.tax_rate||0);
    const taxableBase = discountApplyTax? Math.max(0, pre - discountAmt) : pre;
    const tax = taxableBase * (ratePct/100);

    const dep = Number(deposit||0);
    const grand = Math.max(0, (pre - discountAmt) + tax - dep);

    return {
      preTax: pre,
      discountAmt,
      tax,
      grand
    };
  },[effectiveTotals, discountType, discountValue, discountApplyTax, deposit, settings?.tax_rate]);

  const onSave=async ()=>{
    const newTotals={
      ...(effectiveTotals||{}),
      showInkUsage,
      discountApplyTax
    };
    const payload={
      memo,
      discount: Number(discountValue||0),
      discount_type: discountType,
      deposit: Number(deposit||0),
      totals: newTotals
    };
    const {data,error}=await supabase
      .from("invoices")
      .update(payload)
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id)
      .select("*")
      .single();
    if(error){ alert(error.message); return; }
    onSaved?.(data);
  };

  if(loading) return <div className="tiny">Loading…</div>;
  const t=effectiveTotals||{};

  return (
    <div>
      <h3 className="m-0">Edit Invoice <span className="tiny mono">#{row.code}</span></h3>

      <div className="grid-3" style={{marginTop:12, gap:12}}>
        
        {/* BASE CHARGES */}
        <div className="card">
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
            <div style={{width:16, height:16, backgroundColor:'#e0e0e0', borderRadius:2}}></div>
            <b style={{fontSize:13, color:'#555'}}>BASE CHARGES</b>
          </div>
          <div className="tiny">Equipment: <span style={{color:'#2563eb', fontWeight:'500'}}>${Number(t.equipmentCharge||0).toFixed(2)}</span></div>
          <div className="tiny">UV/Sublimation Ink: <span style={{color:'#7c3aed', fontWeight:'500'}}>${Number(t.inkCharge||0).toFixed(2)}</span></div>
          <div className="tiny">Materials: <span style={{color:'#059669', fontWeight:'500'}}>${Number(t.materialsCharge||0).toFixed(2)}</span></div>
          <div className="tiny">Labor: <span style={{color:'#dc2626', fontWeight:'500'}}>${Number(t.laborCharge||0).toFixed(2)}</span></div>
          <div className="tiny">Add-ons: <span style={{color:'#ea580c', fontWeight:'500'}}>${Number(t.addonsCharge||0).toFixed(2)}</span></div>
          <div className="tiny" style={{marginTop:6, paddingTop:6, borderTop:'1px solid #eee'}}>
            <b>Subtotal: <span style={{color:'#1f2937', fontSize:'13px', backgroundColor:'#f3f4f6', padding:'2px 6px', borderRadius:'4px'}}>${calc.preTax.toFixed(2)}</span></b>
          </div>
        </div>

        {/* ADJUSTMENTS */}
        <div className="card">
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
            <div style={{width:16, height:16, backgroundColor:'#d0d0d0', borderRadius:2}}></div>
            <b style={{fontSize:13, color:'#555'}}>ADJUSTMENTS</b>
          </div>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:8}}>
            <div className="group">
              <label style={{fontSize:11}}>Type</label>
              <select value={discountType} onChange={(e)=>setDiscountType(e.target.value)} style={{fontSize:12}}>
                <option value="percent">Percent %</option>
                <option value="flat">Flat $</option>
              </select>
            </div>
            <div className="group">
              <label style={{fontSize:11}}>Discount</label>
              <input type="number" step="0.01" value={discountValue} onChange={(e)=>setDiscountValue(e.target.value)} style={{fontSize:12}} />
            </div>
          </div>
          <div className="group" style={{marginBottom:8}}>
            <label style={{fontSize:11}}>Deposit</label>
            <input type="number" step="0.01" value={deposit} onChange={(e)=>setDeposit(e.target.value)} style={{fontSize:12}} />
          </div>
          <div style={{display:"flex", alignItems:"center", gap:6, fontSize:11}}>
            <input id="applytax" type="checkbox" checked={discountApplyTax} onChange={(e)=>setDiscountApplyTax(e.target.checked)} />
            <label htmlFor="applytax">Apply tax after discount</label>
          </div>
          {discountValue > 0 && (
            <div style={{marginTop:6, padding:'4px 8px', backgroundColor:'#fef3c7', borderRadius:'4px', border:'1px solid #f59e0b'}}>
              <span style={{fontSize:10, color:'#92400e'}}>💰 Discount: <span style={{fontWeight:'bold', color:'#d97706'}}>-${calc.discountAmt.toFixed(2)}</span></span>
            </div>
          )}
          {deposit > 0 && (
            <div style={{marginTop:4, padding:'4px 8px', backgroundColor:'#dcfce7', borderRadius:'4px', border:'1px solid #16a34a'}}>
              <span style={{fontSize:10, color:'#166534'}}>🏦 Deposit: <span style={{fontWeight:'bold', color:'#15803d'}}>-${Number(deposit||0).toFixed(2)}</span></span>
            </div>
          )}
        </div>

        {/* TOTALS */}
        <div className="card">
          <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8}}>
            <div style={{width:16, height:16, backgroundColor:'#c0c0c0', borderRadius:2}}></div>
            <b style={{fontSize:13, color:'#555'}}>FINAL TOTALS</b>
          </div>
          <div className="tiny">Tax ({Number(settings?.tax_rate||0).toFixed(1)}%): <span style={{color:'#7c2d12', fontWeight:'500'}}>${calc.tax.toFixed(2)}</span></div>
          <div className="tiny">Discount: <span style={{color:'#d97706', fontWeight:'600'}}>−${calc.discountAmt.toFixed(2)}</span></div>
          <div className="tiny">Deposit: <span style={{color:'#15803d', fontWeight:'600'}}>−${Number(deposit||0).toFixed(2)}</span></div>
          <div className="tiny" style={{marginTop:6, paddingTop:6, borderTop:'1px solid #333'}}>
            <b>Grand Total: <span style={{fontSize:'14px', color:'#fff', backgroundColor:'#1f2937', padding:'3px 8px', borderRadius:'6px', boxShadow:'0 2px 4px rgba(0,0,0,0.1)'}}>${calc.grand.toFixed(2)}</span></b>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:6, marginTop:10, fontSize:11}}>
            <input id="showink" type="checkbox" checked={showInkUsage} onChange={(e)=>setShowInkUsage(e.target.checked)} />
            <label htmlFor="showink">Show ink usage on PDF</label>
          </div>
        </div>
      </div>

      {/* MEMO SECTION */}
      <div style={{marginTop:12}}>
        <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:6}}>
          <div style={{width:16, height:16, backgroundColor:'#b0b0b0', borderRadius:2}}></div>
          <label style={{fontSize:13, color:'#555', fontWeight:'bold'}}>INVOICE MEMO</label>
        </div>
        <textarea 
          rows={3} 
          value={memo} 
          onChange={(e)=>setMemo(e.target.value)}
          style={{fontSize:12, width:'100%', resize:'vertical'}}
          placeholder="Internal notes or special instructions..."
        />
      </div>

      <div className="btn-row" style={{marginTop:12, paddingTop:12, borderTop:'1px solid #eee'}}>
        <button className="btn btn-primary" onClick={onSave}>Save Changes</button>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}