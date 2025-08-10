import React,{useEffect,useMemo,useState} from "react";
import {supabase} from "../../lib/superbase.js";
import {useTenant} from "../../context/TenantContext.jsx";

/**
 * Props:
 *  - invoiceId: uuid
 *  - onClose: ()=>void
 */
export default function InvoiceEditor({invoiceId,onClose}){
  const {tenantId}=useTenant();

  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [row,setRow]=useState(null);
  const [settings,setSettings]=useState(null);
  const [customer,setCustomer]=useState(null);

  // reference maps
  const [matMap,setMatMap]=useState({}); // id -> {selling_price, name}
  const [eqMap,setEqMap]=useState({});   // id -> equipment row (ink rates etc.)

  // UI-only toggle; persisted inside totals.showInkUsage
  const [showInk,setShowInk]=useState(false);

  // Local editable fields (persisted into totals only)
  const [memo,setMemo]=useState("");
  const [discountType,setDiscountType]=useState("none"); // none|flat|percent
  const [discountValue,setDiscountValue]=useState(0);
  const [applyTaxToDiscount,setApplyTaxToDiscount]=useState(true);
  const [deposit,setDeposit]=useState(0);

  useEffect(()=>{
    let cancel=false;
    const load=async ()=>{
      setLoading(true);
      try{
        const invQ=supabase.from("invoices").select("*").eq("id",invoiceId).eq("tenant_id",tenantId).maybeSingle();
        const setQ=supabase.from("settings").select("*").eq("tenant_id",tenantId).maybeSingle();
        const [{data:inv,error:e1},{data:set,error:e2}]=await Promise.all([invQ,setQ]);
        if(e1) throw e1;
        if(e2) throw e2;
        if(!inv) throw new Error("Invoice not found");

        let cust=null;
        if(inv.customer_id){
          const {data:c}=await supabase.from("customers")
            .select("id,company,name,email,phone,address,website")
            .eq("id",inv.customer_id).maybeSingle();
          cust=c||null;
        }

        const items=inv.items||{};
        const mats=Array.isArray(items.materials)? items.materials: [];
        const eqs =Array.isArray(items.equipments)? items.equipments: [];

        // materials map
        let mm={};
        if(mats.length){
          const matIds=[...new Set(mats.map(m=>m.material_id).filter(Boolean))];
          if(matIds.length){
            const {data:matRows}=await supabase.from("materials")
              .select("id,name,selling_price")
              .in("id", matIds)
              .eq("tenant_id", tenantId);
            (matRows||[]).forEach(m=>{ mm[m.id]={name:m.name, selling_price:Number(m.selling_price||0)}; });
          }
        }
        // equipments map (ink rates / modes)
        let em={};
        if(eqs.length){
          const eqIds=[...new Set(eqs.map(e=>e.equipment_id).filter(Boolean))];
          if(eqIds.length){
            const {data:eqRows}=await supabase
              .from("equipments")
              .select("*")
              .in("id", eqIds)
              .eq("tenant_id", tenantId);
            (eqRows||[]).forEach(e=>{ em[e.id]=e; });
          }
        }

        if(cancel) return;
        setRow(inv);
        setSettings(set||null);
        setCustomer(cust);
        setMatMap(mm);
        setEqMap(em);

        const t=inv.totals||{};
        setShowInk(Boolean(t.showInkUsage));
        setMemo(inv.memo ?? "");
        setDiscountType((inv.discount_type ?? t.discountType ?? "none")||"none");
        setDiscountValue(Number(inv.discount_value ?? t.discountValue ?? 0) || 0);
        setApplyTaxToDiscount(
          typeof inv.discount_apply_tax==="boolean"
            ? inv.discount_apply_tax
            : (typeof t.discountApplyTax==="boolean" ? t.discountApplyTax : true)
        );
        setDeposit(Number(inv.deposit ?? t.deposit ?? 0) || 0);
      }catch(ex){
        console.error(ex);
        alert(ex.message||"Failed to load invoice");
        onClose?.();
      }finally{
        if(!cancel) setLoading(false);
      }
    };
    if(invoiceId&&tenantId){load();}
    return ()=>{cancel=true;};
  },[invoiceId,tenantId,onClose]);

  const toNum=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
  const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):(0).toFixed(d);
  const r2=(x)=>Math.round((toNum(x)+Number.EPSILON)*100)/100;

  // Pull tax strictly from settings; now includes snake_case tax_rate
  const taxRate = useMemo(()=>{
    const s=settings||{};
    const candidates=[
      s.tax_rate, // <— your settings shape
      s.tax_pct, s.tax_percent, s.taxPercent, s.taxRate, s.tax,
      s.finance?.tax_pct, s.finance?.taxPercent, s.finance?.taxRate, s.finance?.tax,
      s.branding?.tax_pct, s.branding?.taxPercent, s.branding?.taxRate, s.branding?.tax,
      s.business?.finance?.tax_pct, s.business?.finance?.taxRate, s.business?.finance?.tax,
      // fallback to whatever was on the invoice totals
      row?.totals?.taxPct
    ];
    for(const c of candidates){
      const n=Number(c);
      if(Number.isFinite(n) && n>=0 && n<=100) return n;
    }
    return 0;
  },[settings,row]);

  // Try to obtain ink rates for a line even if equipment row is unavailable
  const extractRatesFromLine=(l)=>{
    if(l?.ink_rates && typeof l.ink_rates==='object'){
      const r=l.ink_rates;
      return {
        c:toNum(r.c), m:toNum(r.m), y:toNum(r.y), k:toNum(r.k),
        white:toNum(r.white), soft_white:toNum(r.soft_white), gloss:toNum(r.gloss)
      };
    }
    return {
      c:toNum(l?.ink_rate_c), m:toNum(l?.ink_rate_m), y:toNum(l?.ink_rate_y), k:toNum(l?.ink_rate_k),
      white:toNum(l?.ink_rate_white), soft_white:toNum(l?.ink_rate_soft_white), gloss:toNum(l?.ink_rate_gloss)
    };
  };

  const recomputeFromItems = useMemo(()=>{
    if(!row) return {inkCharge:0, matCharge:0, eqCharge:0, laborCharge:0, addonCharge:0};
    const items=row.items||{};
    const mats=Array.isArray(items.materials)? items.materials: [];
    const eqs =Array.isArray(items.equipments)? items.equipments: [];
    const adds=Array.isArray(items.addons)? items.addons: [];
    const labs=Array.isArray(items.labor)? items.labor: [];
    const marginPct = Number(items.meta?.marginPct ?? 100);

    // materials charge: selling_price * qty
    let matCharge = mats.reduce((s,m)=>{
      const unit = toNum(m.selling_price ?? matMap[m.material_id]?.selling_price ?? m.unit);
      return s + toNum(m.qty) * unit;
    },0);

    const isUVish = (t)=> {
      const x=(t||"").toLowerCase();
      return x.includes("uv") || x.includes("sublimation");
    };

    let eqCharge = 0;
    let inkCharge = 0; // we roll UV into eqCharge; inkCharge kept here for display if you want it separated

    for(const l of eqs){
      const t=(l.type||"").toLowerCase();
      if(isUVish(t)){
        const eq = l.equipment_id ? eqMap[l.equipment_id] : null;
        const rateFromEq = eq ? {
          c: toNum(eq.ink_rate_c),
          m: toNum(eq.ink_rate_m),
          y: toNum(eq.ink_rate_y),
          k: toNum(eq.ink_rate_k),
          white: toNum(eq.ink_rate_white),
          soft_white: toNum(eq.ink_rate_soft_white),
          gloss: toNum(eq.ink_rate_gloss),
        } : null;
        const rateFallback = extractRatesFromLine(l);
        const rates = rateFromEq ?? rateFallback;

        const inks=l.inks||{};
        const usingWhiteKey = l.use_soft_white ? "soft_white" : "white";
        const channels = ["c","m","y","k","gloss", usingWhiteKey];
        const base = channels.reduce((sum,ch)=>{
          const ml = toNum(inks[ch]);
          const rate = toNum(rates[ch]);
          return sum + (ml*rate);
        },0);

        const withMargin = base * (1 + (toNum(marginPct)/100));
        eqCharge += withMargin;
        inkCharge += withMargin; // keep in case you want to show ink separately
      }else{
        if(l.charge!=null){ eqCharge += toNum(l.charge); continue; }
        if(l.mode==="hourly"){ eqCharge += toNum(l.hours)*toNum(l.rate); continue; }
        if(l.mode==="flat"){ eqCharge += toNum(l.flat_fee); continue; }
      }
    }

    const laborCharge = labs.reduce((s,l)=> s + toNum(l.hours)*toNum(l.rate), 0);
    const addonCharge = adds.reduce((s,a)=> s + toNum(a.qty)*toNum(a.price), 0);

    return {inkCharge, matCharge, eqCharge, laborCharge, addonCharge, marginPct};
  },[row,matMap,eqMap,tenantId]);

  const breakdown=useMemo(()=>{
    if(!row) return null;
    const t=row.totals||{};
    let inkCharge   = toNum(t.inkCharge);
    let matCharge   = toNum(t.matCharge);
    let eqCharge    = toNum(t.eqCharge);
    let laborCharge = toNum(t.laborCharge);
    let addonCharge = toNum(t.addonCharge);

    const items=row.items||{};
    const hasItems = (Array.isArray(items.materials)&&items.materials.length)
                  || (Array.isArray(items.equipments)&&items.equipments.length)
                  || (Array.isArray(items.addons)&&items.addons.length)
                  || (Array.isArray(items.labor)&&items.labor.length);

    if(hasItems){
      const r=recomputeFromItems;
      if(inkCharge===0 && r.inkCharge) inkCharge=r.inkCharge;
      if(matCharge===0 && r.matCharge) matCharge=r.matCharge;
      if(eqCharge===0 && r.eqCharge)   eqCharge=r.eqCharge;
      if(laborCharge===0 && r.laborCharge) laborCharge=r.laborCharge;
      if(addonCharge===0 && r.addonCharge) addonCharge=r.addonCharge;
    }

    const preTax = r2(inkCharge + matCharge + eqCharge + laborCharge + addonCharge);

    // discount / tax / deposit
    const dType = discountType;
    const dVal  = toNum(discountValue);
    const discount = dType==="percent" ? r2(preTax*(dVal/100)) : (dType==="flat" ? r2(dVal) : 0);

    const taxBase = applyTaxToDiscount ? Math.max(0,preTax - discount) : preTax;
    const tax = r2(taxBase * (toNum(taxRate)/100));
    const total = r2((preTax - discount) + tax);
    const due = r2(total - toNum(deposit));

    return {
      inkCharge, matCharge, eqCharge, laborCharge, addonCharge,
      preTax, discount, taxRate: toNum(taxRate), tax, total,
      deposit: toNum(deposit), due
    };
  },[
    row, recomputeFromItems,
    discountType,discountValue,applyTaxToDiscount,deposit,taxRate
  ]);

  const save=async ()=>{
    if(!row||!breakdown) return;
    setSaving(true);
    try{
      const nextTotals={
        ...(row.totals||{}),
        showInkUsage: !!showInk,

        // Persist rolled-up charges so views are stable later
        inkCharge: r2(breakdown.inkCharge),
        matCharge: r2(breakdown.matCharge),
        eqCharge: r2(breakdown.eqCharge),
        laborCharge: r2(breakdown.laborCharge),
        addonCharge: r2(breakdown.addonCharge),
        totalChargePreTax: r2(breakdown.preTax),

        discountType,
        discountValue: toNum(discountValue),
        discountAmount: r2(breakdown.discount),
        discountApplyTax: !!applyTaxToDiscount,

        taxPct: toNum(taxRate),
        tax: r2(breakdown.tax),

        grandTotal: r2(breakdown.total),
        deposit: toNum(deposit),
        totalDue: r2(breakdown.due)
      };

      const patch={ memo, totals: nextTotals };

      const {error}=await supabase.from("invoices")
        .update(patch)
        .eq("id", row.id)
        .eq("tenant_id", row.tenant_id);
      if(error) throw error;

      alert("Invoice saved.");
      onClose?.();
    }catch(ex){
      console.error(ex);
      alert(ex.message||"Save failed");
    }finally{
      setSaving(false);
    }
  };

  if(loading){
    return (
      <div className="modal" onClick={()=>onClose?.()}>
        <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
          <h3 style={{margin:0}}>Edit Invoice</h3>
          <div className="tiny">Loading…</div>
        </div>
      </div>
    );
  }
  if(!row) return null;

  const items=row.items||{};
  const eq=Array.isArray(items.equipments)?items.equipments:[];
  const mats=Array.isArray(items.materials)?items.materials:[];
  const adds=Array.isArray(items.addons)?items.addons:[];
  const labs=Array.isArray(items.labor)?items.labor:[];

  return (
    <div className="modal" onClick={()=>onClose?.()}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3 style={{margin:0}}>Edit Invoice <span className="tiny mono">#{row.code}</span></h3>
        <div className="btn-row">
            <button className="btn btn-secondary" onClick={()=>onClose?.()}>Close</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</button>
          </div>
        </div>

        {/* Header summary */}
        <HeaderSummary settings={settings} row={row} customer={customer} showInk={showInk} setShowInk={setShowInk}/>

        {/* Read-only items */}
        <ItemsReadOnly
          eq={eq} mats={mats} labs={labs} adds={adds}
          matMap={matMap} eqMap={eqMap}
          showInk={showInk}
          marginPct={Number(items.meta?.marginPct ?? 100)}
        />

        {/* Adjustments */}
        <Adjustments
          memo={memo} setMemo={setMemo}
          discountType={discountType} setDiscountType={setDiscountType}
          discountValue={discountValue} setDiscountValue={setDiscountValue}
          applyTaxToDiscount={applyTaxToDiscount} setApplyTaxToDiscount={setApplyTaxToDiscount}
          deposit={deposit} setDeposit={setDeposit}
        />

        {/* Live totals */}
        {breakdown?(
          <Totals breakdown={breakdown}/>
        ):null}
      </div>
    </div>
  );
}

function HeaderSummary({settings,row,customer,showInk,setShowInk}){
  return (
    <div className="grid-3" style={{marginTop:10}}>
      <div className="card">
        <div className="tiny" style={{color:"#666"}}>Customer</div>
        <div><b>{customer?.company||customer?.name||"—"}</b></div>
        {customer?.email?<div className="tiny">{customer.email}</div>:null}
        {customer?.phone?<div className="tiny">{customer.phone}</div>:null}
      </div>
      <div className="card">
        <div className="tiny" style={{color:"#666"}}>Created</div>
        <div>{new Date(row.created_at).toLocaleString()}</div>
      </div>
      <div className="card">
        <div className="tiny" style={{color:"#666"}}>Show ink usage on invoice</div>
        <div className="row" style={{gap:8}}>
          <label className="tiny">Off</label>
          <input type="checkbox" checked={showInk} onChange={(e)=>setShowInk(e.target.checked)}/>
          <label className="tiny">On</label>
        </div>
      </div>
    </div>
  );
}

function ItemsReadOnly({eq,mats,labs,adds,matMap,eqMap,showInk,marginPct}){
  const toNum=(v)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
  const n2=(x)=>Number(x||0).toFixed(2);
  const n4=(x)=>Number(x||0).toFixed(4);

  const isUVish=(t)=>{ const x=(t||"").toLowerCase(); return x.includes("uv")||x.includes("sublimation"); };

  const perLineCharge=(line)=>{
    const t=(line.type||"").toLowerCase();
    if(!isUVish(t)){
      if(line.charge!=null) return toNum(line.charge);
      if(line.mode==="hourly") return toNum(line.hours)*toNum(line.rate);
      if(line.mode==="flat") return toNum(line.flat_fee);
      return 0;
    }
    // UV/Sublimation: compute from inks * rates, then apply margin
    const eq = line.equipment_id ? eqMap[line.equipment_id] : null;
    const rates = eq ? {
      c: toNum(eq.ink_rate_c),
      m: toNum(eq.ink_rate_m),
      y: toNum(eq.ink_rate_y),
      k: toNum(eq.ink_rate_k),
      white: toNum(eq.ink_rate_white),
      soft_white: toNum(eq.ink_rate_soft_white),
      gloss: toNum(eq.ink_rate_gloss),
    } : {
      c: toNum(line.ink_rate_c), m: toNum(line.ink_rate_m), y: toNum(line.ink_rate_y), k: toNum(line.ink_rate_k),
      white: toNum(line.ink_rate_white), soft_white: toNum(line.ink_rate_soft_white), gloss: toNum(line.ink_rate_gloss),
    };
    const inks=line.inks||{};
    const usingWhiteKey = line.use_soft_white ? "soft_white" : "white";
    const channels=["c","m","y","k","gloss", usingWhiteKey];
    const base = channels.reduce((sum,ch)=> sum + (toNum(inks[ch])*toNum(rates[ch])), 0);
    return base * (1 + (toNum(marginPct)/100));
  };

  return (
    <div className="card" style={{marginTop:12}}>
      <h4 style={{marginTop:0,marginBottom:12}}>Items</h4>

      {/* Equipment */}
      {eq.length>0?(
        <>
          <div className="tiny" style={{fontWeight:700,marginBottom:6}}>Equipment</div>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:"45%"}}>Description</th>
                <th>Mode</th>
                <th style={{textAlign:"right"}}>Charge</th>
              </tr>
            </thead>
            <tbody>
              {eq.map((e,i)=>{
                const desc=e.desc||e.name||e.type||"Equipment";
                const type=(e.type||'').toLowerCase();
                const charge = perLineCharge(e);

                if(type.includes('uv')||type.includes('sublimation')){
                  const inks=e.inks||{};
                  const parts=[
                    showInk && inks.c>0? `C:${n4(inks.c)}ml`:null,
                    showInk && inks.m>0? `M:${n4(inks.m)}ml`:null,
                    showInk && inks.y>0? `Y:${n4(inks.y)}ml`:null,
                    showInk && inks.k>0? `K:${n4(inks.k)}ml`:null,
                    showInk && inks.gloss>0? `Gloss:${n4(inks.gloss)}ml`:null,
                    showInk && toNum(inks.white)>0? `White:${n4(inks.white)}ml`:null,
                    showInk && toNum(inks.soft_white)>0? `Soft White:${n4(inks.soft_white)}ml`:null,
                  ].filter(Boolean).join(' • ');
                  return (
                    <tr key={i}>
                      <td>
                        {desc}
                        {parts? <div className="tiny" style={{color:"#666",marginTop:4}}>{parts}</div>:null}
                      </td>
                      <td>UV</td>
                      <td style={{textAlign:"right"}}>${n2(charge)}</td>
                    </tr>
                  );
                }
                return (
                  <tr key={i}>
                    <td>{desc}</td>
                    <td>{e.mode||(e.charge!=null?"set":"—")}</td>
                    <td style={{textAlign:"right"}}>${n2(charge)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ):null}

      {/* Materials */}
      {mats.length>0?(
        <>
          <div className="tiny" style={{fontWeight:700,margin:"10px 0 6px"}}>Materials</div>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:"55%"}}>Material</th>
                <th>Qty</th>
                <th style={{textAlign:"right"}}>Unit</th>
                <th style={{textAlign:"right"}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {mats.map((m,i)=>{
                const qty=toNum(m.qty);
                const unit=toNum(m.selling_price ?? matMap[m.material_id]?.selling_price ?? m.unit);
                const tot=qty*unit;
                return (
                  <tr key={i}>
                    <td>{m.name||m.description||"Material"}</td>
                    <td>{qty}</td>
                    <td style={{textAlign:"right"}}>${n2(unit)}</td>
                    <td style={{textAlign:"right"}}>${n2(tot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ):null}

      {/* Labor */}
      {labs.length>0?(
        <>
          <div className="tiny" style={{fontWeight:700,margin:"10px 0 6px"}}>Labor</div>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:"60%"}}>Description</th>
                <th>Hours</th>
                <th style={{textAlign:"right"}}>Rate</th>
                <th style={{textAlign:"right"}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {labs.map((l,i)=>{
                const tot=toNum(l.hours)*toNum(l.rate);
                return (
                  <tr key={i}>
                    <td>{l.desc||"Labor"}</td>
                    <td>{Number(l.hours||0).toFixed(2)}</td>
                    <td style={{textAlign:"right"}}>${n2(l.rate)}</td>
                    <td style={{textAlign:"right"}}>${n2(tot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ):null}

      {/* Add-ons */}
      {adds.length>0?(
        <>
          <div className="tiny" style={{fontWeight:700,margin:"10px 0 6px"}}>Add-ons</div>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:"60%"}}>Name</th>
                <th>Qty</th>
                <th style={{textAlign:"right"}}>Price</th>
                <th style={{textAlign:"right"}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {adds.map((a,i)=>{
                const tot=toNum(a.qty)*toNum(a.price);
                return (
                  <tr key={i}>
                    <td>{a.name||a.description||"Add-on"}</td>
                    <td>{a.qty}</td>
                    <td style={{textAlign:"right"}}>${n2(a.price)}</td>
                    <td style={{textAlign:"right"}}>${n2(tot)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ):null}
    </div>
  );
}

function Adjustments({
  memo,setMemo,
  discountType,setDiscountType,
  discountValue,setDiscountValue,
  applyTaxToDiscount,setApplyTaxToDiscount,
  deposit,setDeposit
}){
  return (
    <div className="card" style={{marginTop:12}}>
      <h4 style={{marginTop:0}}>Adjustments</h4>
      <div className="grid-3">
        <div className="group">
          <label>Discount Type</label>
          <select value={discountType} onChange={(e)=>setDiscountType(e.target.value)}>
            <option value="none">None</option>
            <option value="flat">Flat</option>
            <option value="percent">Percent</option>
          </select>
        </div>
        <div className="group">
          <label>Discount Value</label>
          <input type="number" step="0.01" value={discountValue} onChange={(e)=>setDiscountValue(e.target.value)}/>
        </div>
        <div className="group">
          <label>Apply Tax To Discount</label>
          <select value={applyTaxToDiscount?"yes":"no"} onChange={(e)=>setApplyTaxToDiscount(e.target.value==="yes")}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>

        <div className="group">
          <label>Deposit</label>
          <input type="number" step="0.01" value={deposit} onChange={(e)=>setDeposit(e.target.value)}/>
        </div>

        <div className="group" style={{gridColumn:"1 / -1"}}>
          <label>Memo</label>
          <textarea rows={3} value={memo} onChange={(e)=>setMemo(e.target.value)}/>
        </div>
      </div>
    </div>
  );
}

function Totals({breakdown}){
  const n2=(x)=>Number(x||0).toFixed(2);
  return (
    <div className="card" style={{marginTop:12}}>
      <div className="grid-3">
        <div><b>Ink (with margin)</b><br/>${n2(breakdown.inkCharge)}</div>
        <div><b>Materials</b><br/>${n2(breakdown.matCharge)}</div>
        <div><b>Equipment</b><br/>${n2(breakdown.eqCharge)}</div>
        <div><b>Labor</b><br/>${n2(breakdown.laborCharge)}</div>
        <div><b>Add-ons</b><br/>${n2(breakdown.addonCharge)}</div>
        <div><b>Pre-tax</b><br/>${n2(breakdown.preTax)}</div>
        <div><b>Discount</b><br/>-${n2(breakdown.discount)}</div>
        <div><b>Tax ({Number(breakdown.taxRate||0).toFixed(2)}%)</b><br/>${n2(breakdown.tax)}</div>
        <div><b>Total</b><br/>${n2(breakdown.total)}</div>
        <div><b>Deposit</b><br/>-${n2(breakdown.deposit)}</div>
        <div><b>Amount Due</b><br/>${n2(breakdown.due)}</div>
      </div>
    </div>
  );
}
