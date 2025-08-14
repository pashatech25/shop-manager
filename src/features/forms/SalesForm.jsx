// ADD near other imports
import { webhookQuoteCreated } from "../../features/webhook/api.js";
import React, {useEffect, useMemo, useState} from "react";
import {useTenant} from "../../context/TenantContext.jsx";
import {supabase} from "../../lib/superbase.js";
import {toast} from "react-toastify";

/**
 * Props:
 *  - kind: "quote" | "job"
 *  - row?: existing row (if editing)
 *  - onSaved?: (row)=>void
 */
export default function SalesForm({kind="quote", row=null, onSaved}){
  const {tenantId}=useTenant();

  // reference data
  const [loading,setLoading]=useState(true);
  const [err,setErr]=useState("");
  const [customers,setCustomers]=useState([]);
  const [equipments,setEquipments]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [addons,setAddons]=useState([]);

  // form basics
  const [title,setTitle]=useState("");
  const [customerId,setCustomerId]=useState("");
  const [marginPct,setMarginPct]=useState(100); // stored inside items.meta

  // lines
  const [eqLines,setEqLines]=useState([]);
  const [matLines,setMatLines]=useState([]);
  const [addonLines,setAddonLines]=useState([]);
  const [laborLines,setLaborLines]=useState([]);

  // ----- load reference data -----
  useEffect(()=>{
    let cancel=false;
    (async ()=>{
      try{
        setLoading(true); setErr("");
        if(!tenantId){
          setCustomers([]); setEquipments([]); setMaterials([]); setAddons([]); return;
        }
        const [c,e,m,a]=await Promise.all([
          supabase.from("customers").select("id,name,company,email").eq("tenant_id", tenantId).order("name",{ascending:true}),
          supabase.from("equipments").select("*").eq("tenant_id", tenantId).order("created_at",{ascending:false}),
          supabase.from("materials").select("id,name,on_hand,purchase_price,selling_price").eq("tenant_id", tenantId).order("name",{ascending:true}),
          supabase.from("addons").select("id,name,description").eq("tenant_id", tenantId).order("created_at",{ascending:false})
        ]);
        if(c.error) throw c.error; if(e.error) throw e.error; if(m.error) throw m.error; if(a.error) throw a.error;
        if(cancel) return;
        setCustomers(c.data||[]); setEquipments(e.data||[]); setMaterials(m.data||[]); setAddons(a.data||[]);
      }catch(ex){
        if(!cancel) setErr(ex.message||"Failed to load reference data");
      }finally{
        if(!cancel) setLoading(false);
      }
    })();
    return ()=>{ cancel=true; };
  },[tenantId]);

  // ----- hydrate from existing row if editing -----
  useEffect(()=>{
    if(!row){ // new
      setTitle(""); setCustomerId(""); setMarginPct(100);
      setEqLines([]); setMatLines([]); setAddonLines([]); setLaborLines([]);
      return;
    }
    setTitle(row.title||"");
    setCustomerId(row.customer_id||"");
    const mp=row.items?.meta?.marginPct;
    setMarginPct(mp!=null? Number(mp) : 100);
    setEqLines(Array.isArray(row.items?.equipments)? row.items.equipments : []);
    setMatLines(Array.isArray(row.items?.materials)? row.items.materials : []);
    setAddonLines(Array.isArray(row.items?.addons)? row.items.addons : []);
    setLaborLines(Array.isArray(row.items?.labor)? row.items.labor : []);
  },[row]);

  // ---------- helpers ----------
  const UV_TYPES=new Set(["uv printer","sublimation printer"]);

  const addEq=()=> setEqLines(v=>[...v,{
    equipment_id:"",
    type:"",
    mode:"hourly", // for non-UV types
    hours:0, rate:0, flat_fee:0,
    inks:{c:0,m:0,y:0,k:0,white:0,soft_white:0,gloss:0},
    use_soft_white:false
  }]);
  const addMat=()=> setMatLines(v=>[...v,{material_id:"", qty:1}]);
  const addAddon=()=> setAddonLines(v=>[...v,{addon_id:"", qty:1, price:0}]);
  const addLabor=()=> setLaborLines(v=>[...v,{desc:"", hours:0, rate:0}]);

  // ---------- totals (now includes UV/Sublimation ink pricing) ----------
  const totals = useMemo(()=>{
    const eqMap = new Map(equipments.map(e => [e.id, e]));

    // Materials
    let matCost=0, matCharge=0;
    for(const l of matLines){
      const m = materials.find(x=>x.id===l.material_id);
      if(!m) continue;
      const qty = Number(l.qty||0);
      matCost   += Number(m.purchase_price||0) * qty;
      matCharge += Number(m.selling_price||0) * qty;
    }

    // Equipment (non-UV hourly/flat)
    let eqCharge=0;
    for(const l of eqLines){
      const t=(l.type||"").toLowerCase();
      const isUV = t.includes("uv") || t.includes("sublimation");
      if(isUV) continue;
      if(l.mode==="hourly") eqCharge += Number(l.hours||0) * Number(l.rate||0);
      else eqCharge += Number(l.flat_fee||0);
    }

    // Labor / Add-ons
    let laborCharge=0; for(const l of laborLines) laborCharge += Number(l.hours||0)*Number(l.rate||0);
    let addonCharge=0; for(const l of addonLines) addonCharge += Number(l.qty||0)*Number(l.price||0);

    // UV / Sublimation ink cost (per-mL)
    let inkCost = 0;
    for(const l of eqLines){
      const t=(l.type||"").toLowerCase();
      const isUV = t.includes("uv") || t.includes("sublimation");
      if(!isUV) continue;

      const eq = l.equipment_id ? eqMap.get(l.equipment_id) : null;
      if(!eq) continue;

      const rC=+eq.rate_c||0, rM=+eq.rate_m||0, rY=+eq.rate_y||0, rK=+eq.rate_k||0;
      const rW=+eq.rate_white||0, rSW=+eq.rate_soft_white||0, rG=+eq.rate_gloss||0;
      const useSW=!!l.use_soft_white;
      const ink=l.inks||{};

      inkCost += Number(ink.c||0)*rC;
      inkCost += Number(ink.m||0)*rM;
      inkCost += Number(ink.y||0)*rY;
      inkCost += Number(ink.k||0)*rK;
      inkCost += Number(ink.gloss||0)*rG;
      inkCost += useSW? Number(ink.soft_white||0)*rSW : Number(ink.white||0)*rW;
    }

    // Margin applies to ink charge
    const margin = Number(marginPct||0);
    const inkCharge = inkCost * (1 + margin/100);

    const totalCost   = matCost + inkCost;
    const totalCharge = matCharge + inkCharge + eqCharge + laborCharge + addonCharge;
    const taxPct = 0, tax = 0, grand = totalCharge;
    const profit = totalCharge - totalCost;
    const profitPct = totalCost>0 ? (profit/totalCost)*100 : 0;

    // expose pre-tax breakdown fields used by invoice editor/view
    return {
      matCost, matCharge,
      eqCharge, laborCharge, addonCharge,
      inkCost, inkCharge,
      totalCost, totalCharge,
      totalChargePreTax: matCharge + inkCharge + eqCharge + laborCharge + addonCharge,
      taxPct, tax, grand, profit, profitPct
    };
  },[materials,matLines,eqLines,laborLines,addonLines,marginPct,equipments]);

  const onSave=async ()=>{
    try{
      if(!tenantId) throw new Error("Tenant not resolved");
      if(!title.trim()) throw new Error("Title is required");
      if(!customerId) throw new Error("Select a customer");
      const table=(kind==="quote")? "quotes":"jobs";

      const common={
        title,
        customer_id:customerId,
        items:{
          meta:{marginPct:Number(marginPct||0)},
          equipments:eqLines,
          materials:matLines,
          addons:addonLines,
          labor:laborLines
        },
        totals
      };

      if(row?.id){
        const {data,error}=await supabase.from(table).update(common).eq("id", row.id).eq("tenant_id", tenantId).select("*").single();
        if(error) throw error;
        toast.success(`${kind==="quote"?"Quote":"Job"} ${data.code} updated`);
        onSaved?.(data); return;
      }

      const {data:codeRow,error:codeErr}=await supabase.rpc("allocate_code",{p_kind:kind,p_tenant_id:tenantId}).single();
      if(codeErr) throw codeErr;
      const payload={tenant_id:tenantId, code:codeRow?.code, status:(kind==="quote"?"open":"active"), ...common};

      const ins=await supabase.from(table).insert(payload).select("*").single();
      if(ins.error) throw ins.error;

      const created=ins.data;
      toast.success(`${kind==="quote"?"Quote":"Job"} ${created.code} created`);
      setTitle(""); setCustomerId(""); setMarginPct(100);
      setEqLines([]); setMatLines([]); setAddonLines([]); setLaborLines([]);
      onSaved?.(created);
      // AFTER successful insert of a quote
await webhookQuoteCreated(tenantId, created).catch((e)=>console.warn("webhookQuoteCreated failed:", e));

    }catch(ex){
      console.error(ex);
      toast.error(ex.message||"Save failed");
    }
  };

  const equipById=useMemo(()=>{ const m=new Map(); for(const e of equipments) m.set(e.id,e); return m; },[equipments]);
  const flipWhiteVariant=(line, useSW)=>({ ...line, use_soft_white:useSW, inks:{...(line.inks||{})} });

  return (
    <div className="form-card">
      {/* HEADER */}
      <div className="form-header" style={{
        background: '#ffffff',
        color: '#1d1d1f',
        padding: '28px',
        borderRadius: '16px',
        marginBottom: '24px',
        border: '1px solid #e5e5e7',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
      }}>
        <div style={{display: 'flex', alignItems: 'center', gap: '16px'}}>
          <div style={{
            width: '48px',
            height: '48px',
            background: '#f5f5f7',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3c3c43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10,9 9,9 8,9"/>
            </svg>
          </div>
          <div>
            <h2 style={{margin: 0, fontSize: '28px', fontWeight: '600', color: '#1d1d1f'}}>
              {row? (kind==="quote"?"Edit Quote":"Edit Job") : (kind==="quote"?"New Quote":"New Job")}
            </h2>
            <p style={{margin: '6px 0 0 0', color: '#86868b', fontSize: '16px', fontWeight: '400'}}>
              {kind==="quote"? "Create a detailed quote for your customer" : "Set up a new job with equipment, materials and labor"}
            </p>
          </div>
        </div>
      </div>

      {err? <div className="alert alert-danger">{String(err)}</div> : null}
      {loading? <div>Loading reference data…</div> : null}

      {/* BASIC INFORMATION */}
      <div className="form-section" style={{marginBottom: '32px'}}>
        <div className="section-title" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e5e5e7'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: '#007aff',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <h3 style={{margin: 0, color: '#1d1d1f', fontSize: '20px', fontWeight: '600'}}>
            Basic Information
          </h3>
        </div>
        
        <div className="grid-3">
          <div className="group">
            <label style={{color: '#3c3c43', fontWeight: '500'}}>Title</label>
            <input 
              value={title} 
              onChange={(e)=>setTitle(e.target.value)} 
              placeholder="e.g., Panel print 24×36"
              style={{
                background: '#ffffff',
                border: '1px solid #d2d2d7',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '16px',
                transition: 'border-color 0.2s ease'
              }}
            />
          </div>
          <div className="group">
            <label style={{color: '#3c3c43', fontWeight: '500'}}>Customer</label>
            <select 
              value={customerId} 
              onChange={(e)=>setCustomerId(e.target.value)}
              style={{
                background: '#ffffff',
                border: '1px solid #d2d2d7',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '16px'
              }}
            >
              <option value="">Select…</option>
              {customers.map((c)=>(
                <option key={c.id} value={c.id}>{c.company? `${c.company} — ${c.name}`:c.name}</option>
              ))}
            </select>
          </div>
          <div className="group">
            <label style={{color: '#3c3c43', fontWeight: '500'}}>Ink Margin (%)</label>
            <input 
              type="number" 
              min="0" 
              step="1" 
              value={marginPct} 
              onChange={(e)=>setMarginPct(e.target.value)}
              style={{
                background: '#ffffff',
                border: '1px solid #d2d2d7',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '16px'
              }}
            />
          </div>
        </div>
      </div>

      {/* PRODUCTION RESOURCES */}
      <div className="production-resources" style={{marginBottom: '32px'}}>
        <div className="section-title" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '24px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e5e5e7'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: '#30d158',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </div>
          <h3 style={{margin: 0, color: '#1d1d1f', fontSize: '20px', fontWeight: '600'}}>
            Production Resources
          </h3>
        </div>

        {/* Equipments */}
        <div className="resource-category" style={{marginBottom: '24px'}}>
          <div className="category-header" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
            padding: '16px 20px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e5e5e7'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
              <div style={{
                width: '20px',
                height: '20px',
                background: '#007aff',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <h4 style={{margin: 0, color: '#1d1d1f', fontSize: '17px', fontWeight: '600'}}>Equipment</h4>
              <span style={{
                background: '#f5f5f7',
                color: '#3c3c43',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                {eqLines.length}
              </span>
            </div>
            <button 
              className="btn btn-outline-primary" 
              onClick={addEq}
              style={{
                background: 'transparent',
                border: '1px solid #007aff',
                color: '#007aff',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              + Add Equipment
            </button>
          </div>

          {eqLines.map((l,idx)=>{
            const selected=l.equipment_id? equipById.get(l.equipment_id):null;
            const typeRaw=selected?.type || l.type || "";
            const type=(typeRaw||"").toLowerCase();
            const isUV= type.includes("uv") || type.includes("sublimation");

            return (
              <div key={idx} className="card" style={{
                marginBottom: '16px',
                border: '1px solid #e5e5e7',
                borderRadius: '12px',
                padding: '20px',
                background: '#ffffff'
              }}>
                <div className="grid-3">
                  <div className="group">
                    <label style={{color: '#3c3c43', fontWeight: '500'}}>Equipment</label>
                    <select
                      value={l.equipment_id}
                      onChange={(e)=>{
                        const id=e.target.value;
                        const sel=id? equipById.get(id):null;
                        const t=sel?.type || "";
                        const useSW=!!sel?.use_soft_white;
                        setEqLines((xs)=>xs.map((it,i)=>{
                          if(i!==idx) return it;
                          return {...it, equipment_id:id, type:t, use_soft_white:useSW, inks:{...it.inks}};
                        }));
                      }}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #d2d2d7',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '16px'
                      }}
                    >
                      <option value="">Select…</option>
                      {equipments.map((eq)=>(
                        <option key={eq.id} value={eq.id}>{eq.name} {eq.type?`(${eq.type})`:""}</option>
                      ))}
                    </select>
                  </div>

                  <div className="group">
                    <label style={{color: '#3c3c43', fontWeight: '500'}}>Type</label>
                    <input 
                      value={typeRaw} 
                      readOnly 
                      style={{
                        background: '#f5f5f7',
                        border: '1px solid #d2d2d7',
                        borderRadius: '8px',
                        padding: '12px',
                        fontSize: '16px'
                      }} 
                    />
                  </div>

                  {!isUV ? (
                    <div className="group">
                      <label style={{color: '#3c3c43', fontWeight: '500'}}>Mode</label>
                      <select 
                        value={l.mode} 
                        onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, mode:e.target.value}:it))}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #d2d2d7',
                          borderRadius: '8px',
                          padding: '12px',
                          fontSize: '16px'
                        }}
                      >
                        <option value="hourly">Hourly</option>
                        <option value="flat">Flat fee</option>
                      </select>
                    </div>
                  ) : (
                    <div className="group">
                      <label style={{color: '#3c3c43', fontWeight: '500'}}>White vs Soft White</label>
                      <select
                        value={l.use_soft_white? "soft_white":"white"}
                        onChange={(e)=>{
                          const useSW=e.target.value==="soft_white";
                          setEqLines((xs)=>xs.map((it,i)=>i===idx? flipWhiteVariant(it,useSW):it));
                        }}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #d2d2d7',
                          borderRadius: '8px',
                          padding: '12px',
                          fontSize: '16px'
                        }}
                      >
                        <option value="white">White</option>
                        <option value="soft_white">Soft White</option>
                      </select>
                    </div>
                  )}
                </div>

                {!isUV ? (
                  <>
                    {l.mode==="hourly"? (
                      <div className="grid-3" style={{marginTop: '16px'}}>
                        <div className="group">
                          <label style={{color: '#3c3c43', fontWeight: '500'}}>Hours</label>
                          <input 
                            type="number" 
                            min="0" 
                            step="0.01" 
                            value={l.hours} 
                            onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, hours:e.target.value}:it))}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #d2d2d7',
                              borderRadius: '8px',
                              padding: '12px',
                              fontSize: '16px'
                            }}
                          />
                        </div>
                        <div className="group">
                          <label style={{color: '#3c3c43', fontWeight: '500'}}>Rate</label>
                          <input 
                            type="number" 
                            min="0" 
                            step="0.01" 
                            value={l.rate} 
                            onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, rate:e.target.value}:it))}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #d2d2d7',
                              borderRadius: '8px',
                              padding: '12px',
                              fontSize: '16px'
                            }}
                          />
                        </div>
                      </div>
                    ):(
                      <div className="group" style={{marginTop: '16px'}}>
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>Flat Fee</label>
                        <input 
                          type="number" 
                          min="0" 
                          step="0.01" 
                          value={l.flat_fee} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, flat_fee:e.target.value}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>
                    )}
                  </>
                ):(
                  <div style={{marginTop: '20px'}}>
                    <div style={{
                      background: '#f5f5f7',
                      color: '#1d1d1f',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      fontSize: '15px',
                      fontWeight: '600'
                    }}>
                      🎨 Ink Usage (milliliters)
                    </div>
                    <div className="ink-inputs" style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '16px'
                    }}>
                      <div className="group">
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>
                          <span className="ink-color-box" style={{background:"#00b5ff", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                          Cyan (ml)
                        </label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          min="0" 
                          value={l.inks.c} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, c:e.target.value}}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>
                      <div className="group">
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>
                          <span className="ink-color-box" style={{background:"#ff3ea5", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                          Magenta (ml)
                        </label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          min="0" 
                          value={l.inks.m} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, m:e.target.value}}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>
                      <div className="group">
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>
                          <span className="ink-color-box" style={{background:"#ffd400", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                          Yellow (ml)
                        </label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          min="0" 
                          value={l.inks.y} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, y:e.target.value}}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>
                      <div className="group">
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>
                          <span className="ink-color-box" style={{background:"#000", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                          Black (ml)
                        </label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          min="0" 
                          value={l.inks.k} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, k:e.target.value}}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>

                      {l.use_soft_white? (
                        <div className="group">
                          <label style={{color: '#3c3c43', fontWeight: '500'}}>
                            <span className="ink-color-box" style={{background:"#f0f0f0", border:"1px solid #ddd", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                            Soft White (ml)
                          </label>
                          <input 
                            type="number" 
                            step="0.0001" 
                            min="0" 
                            value={l.inks.soft_white} 
                            onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, soft_white:e.target.value}}:it))}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #d2d2d7',
                              borderRadius: '8px',
                              padding: '12px',
                              fontSize: '16px'
                            }}
                          />
                        </div>
                      ):(
                        <div className="group">
                          <label style={{color: '#3c3c43', fontWeight: '500'}}>
                            <span className="ink-color-box" style={{background:"#fff", border:"1px solid #ddd", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                            White (ml)
                          </label>
                          <input 
                            type="number" 
                            step="0.0001" 
                            min="0" 
                            value={l.inks.white} 
                            onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, white:e.target.value}}:it))}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #d2d2d7',
                              borderRadius: '8px',
                              padding: '12px',
                              fontSize: '16px'
                            }}
                          />
                        </div>
                      )}

                      <div className="group">
                        <label style={{color: '#3c3c43', fontWeight: '500'}}>
                          <span className="ink-color-box" style={{background:"#cfcfcf", width: '12px', height: '12px', borderRadius: '2px', display: 'inline-block', marginRight: '8px'}}/> 
                          Gloss (ml)
                        </label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          min="0" 
                          value={l.inks.gloss} 
                          onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, gloss:e.target.value}}:it))}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #d2d2d7',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '16px'
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="btn-row" style={{marginTop: '20px', textAlign: 'right'}}>
                  <button 
                    className="btn btn-danger" 
                    onClick={()=>setEqLines((xs)=>xs.filter((_,i)=>i!==idx))}
                    style={{
                      background: '#ff3b30',
                      border: 'none',
                      color: 'white',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '15px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          {eqLines.length===0? (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: '#86868b',
              background: '#f5f5f7',
              borderRadius: '12px',
              border: '1px dashed #d2d2d7'
            }}>
              <div style={{marginBottom: '12px'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5" style={{margin: '0 auto'}}>
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <div style={{fontSize: '16px', fontWeight: '500'}}>No equipment added yet.</div>
            </div>
          ) : null}
        </div>

        {/* Materials */}
        <div className="resource-category" style={{marginBottom: '24px'}}>
          <div className="category-header" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
            padding: '16px 20px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e5e5e7'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
              <div style={{
                width: '20px',
                height: '20px',
                background: '#ff9500',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27,6.96 12,12.01 20.73,6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <h4 style={{margin: 0, color: '#1d1d1f', fontSize: '17px', fontWeight: '600'}}>Materials</h4>
              <span style={{
                background: '#f5f5f7',
                color: '#3c3c43',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                {matLines.length}
              </span>
            </div>
            <button 
              className="btn btn-outline-primary" 
              onClick={addMat}
              style={{
                background: 'transparent',
                border: '1px solid #007aff',
                color: '#007aff',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              + Add Material
            </button>
          </div>
          
          {matLines.map((l,idx)=>(
            <div key={idx} className="card" style={{
              marginBottom: '16px',
              border: '1px solid #e5e5e7',
              borderRadius: '12px',
              padding: '20px',
              background: '#ffffff'
            }}>
              <div className="grid-3">
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Material</label>
                  <select 
                    value={l.material_id} 
                    onChange={(e)=>setMatLines((xs)=>xs.map((it,i)=>i===idx? {...it, material_id:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  >
                    <option value="">Select…</option>
                    {materials.map((m)=>(<option key={m.id} value={m.id}>{m.name} (on hand: {m.on_hand||0})</option>))}
                  </select>
                </div>
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Quantity</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="1" 
                    value={l.qty} 
                    onChange={(e)=>setMatLines((xs)=>xs.map((it,i)=>i===idx? {...it, qty:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>
              <div className="btn-row" style={{marginTop: '20px', textAlign: 'right'}}>
                <button 
                  className="btn btn-danger" 
                  onClick={()=>setMatLines((xs)=>xs.filter((_,i)=>i!==idx))}
                  style={{
                    background: '#ff3b30',
                    border: 'none',
                    color: 'white',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '15px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          
          {matLines.length===0? (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: '#86868b',
              background: '#f5f5f7',
              borderRadius: '12px',
              border: '1px dashed #d2d2d7'
            }}>
              <div style={{marginBottom: '12px'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5" style={{margin: '0 auto'}}>
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27,6.96 12,12.01 20.73,6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <div style={{fontSize: '16px', fontWeight: '500'}}>No materials added yet.</div>
            </div>
          ) : null}
        </div>

        {/* Add-ons */}
        <div className="resource-category" style={{marginBottom: '24px'}}>
          <div className="category-header" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
            padding: '16px 20px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e5e5e7'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
              <div style={{
                width: '20px',
                height: '20px',
                background: '#5856d6',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <h4 style={{margin: 0, color: '#1d1d1f', fontSize: '17px', fontWeight: '600'}}>Add-ons</h4>
              <span style={{
                background: '#f5f5f7',
                color: '#3c3c43',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                {addonLines.length}
              </span>
            </div>
            <button 
              className="btn btn-outline-primary" 
              onClick={addAddon}
              style={{
                background: 'transparent',
                border: '1px solid #007aff',
                color: '#007aff',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              + Add Add-on
            </button>
          </div>
          
          {addonLines.map((l,idx)=>(
            <div key={idx} className="card" style={{
              marginBottom: '16px',
              border: '1px solid #e5e5e7',
              borderRadius: '12px',
              padding: '20px',
              background: '#ffffff'
            }}>
              <div className="grid-3">
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Add-on</label>
                  <select 
                    value={l.addon_id} 
                    onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, addon_id:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  >
                    <option value="">Select…</option>
                    {addons.map((a)=>(<option key={a.id} value={a.id}>{a.name}</option>))}
                  </select>
                </div>
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Quantity</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="1" 
                    value={l.qty} 
                    onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, qty:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Price</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.01" 
                    value={l.price} 
                    onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, price:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>
              <div className="btn-row" style={{marginTop: '20px', textAlign: 'right'}}>
                <button 
                  className="btn btn-danger" 
                  onClick={()=>setAddonLines((xs)=>xs.filter((_,i)=>i!==idx))}
                  style={{
                    background: '#ff3b30',
                    border: 'none',
                    color: 'white',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '15px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          
          {addonLines.length===0? (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: '#86868b',
              background: '#f5f5f7',
              borderRadius: '12px',
              border: '1px dashed #d2d2d7'
            }}>
              <div style={{marginBottom: '12px'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5" style={{margin: '0 auto'}}>
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </div>
              <div style={{fontSize: '16px', fontWeight: '500'}}>No add-ons added yet.</div>
            </div>
          ) : null}
        </div>

        {/* Labor */}
        <div className="resource-category">
          <div className="category-header" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '16px',
            padding: '16px 20px',
            background: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e5e5e7'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: '12px'}}>
              <div style={{
                width: '20px',
                height: '20px',
                background: '#ff2d92',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <h4 style={{margin: 0, color: '#1d1d1f', fontSize: '17px', fontWeight: '600'}}>Labor</h4>
              <span style={{
                background: '#f5f5f7',
                color: '#3c3c43',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600'
              }}>
                {laborLines.length}
              </span>
            </div>
            <button 
              className="btn btn-outline-primary" 
              onClick={addLabor}
              style={{
                background: 'transparent',
                border: '1px solid #007aff',
                color: '#007aff',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '15px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              + Add Labor
            </button>
          </div>
          
          {laborLines.map((l,idx)=>(
            <div key={idx} className="card" style={{
              marginBottom: '16px',
              border: '1px solid #e5e5e7',
              borderRadius: '12px',
              padding: '20px',
              background: '#ffffff'
            }}>
              <div className="grid-3">
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Description</label>
                  <input 
                    value={l.desc} 
                    onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, desc:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Hours</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.01" 
                    value={l.hours} 
                    onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, hours:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
                <div className="group">
                  <label style={{color: '#3c3c43', fontWeight: '500'}}>Rate</label>
                  <input 
                    type="number" 
                    min="0" 
                    step="0.01" 
                    value={l.rate} 
                    onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, rate:e.target.value}:it))}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #d2d2d7',
                      borderRadius: '8px',
                      padding: '12px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>
              <div className="btn-row" style={{marginTop: '20px', textAlign: 'right'}}>
                <button 
                  className="btn btn-danger" 
                  onClick={()=>setLaborLines((xs)=>xs.filter((_,i)=>i!==idx))}
                  style={{
                    background: '#ff3b30',
                    border: 'none',
                    color: 'white',
                    borderRadius: '8px',
                    padding: '8px 16px',
                    fontSize: '15px',
                    fontWeight: '500',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          
          {laborLines.length===0? (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: '#86868b',
              background: '#f5f5f7',
              borderRadius: '12px',
              border: '1px dashed #d2d2d7'
            }}>
              <div style={{marginBottom: '12px'}}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="1.5" style={{margin: '0 auto'}}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div style={{fontSize: '16px', fontWeight: '500'}}>No labor added yet.</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* FINANCIAL SUMMARY */}
      <div className="financial-summary" style={{marginBottom: '32px'}}>
        <div className="section-title" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e5e5e7'
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            background: '#34c759',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <h3 style={{margin: 0, color: '#1d1d1f', fontSize: '20px', fontWeight: '600'}}>
            Financial Summary
          </h3>
        </div>
        
        <div className="card" style={{
          background: '#ffffff',
          border: '1px solid #e5e5e7',
          borderRadius: '16px',
          padding: '24px'
        }}>
          <div className="grid-3">
            <div style={{textAlign: 'center'}}>
              <div style={{
                fontSize: '15px',
                color: '#86868b',
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                Total Cost
              </div>
              <div style={{
                fontSize: '32px',
                fontWeight: '700',
                color: '#e53e3e'
              }}>
                ${totals.totalCost.toFixed(2)}
              </div>
              <div style={{fontSize: '13px', color: '#86868b', marginTop: '4px'}}>
                Materials + Ink
              </div>
            </div>
            
            <div style={{textAlign: 'center'}}>
              <div style={{
                fontSize: '15px',
                color: '#86868b',
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                Total Charge
              </div>
              <div style={{
                fontSize: '32px',
                fontWeight: '700',
                color: '#2b6cb0'
              }}>
                ${totals.totalCharge.toFixed(2)}
              </div>
              <div style={{fontSize: '13px', color: '#86868b', marginTop: '4px'}}>
                Pre-tax Amount
              </div>
            </div>
            
            <div style={{textAlign: 'center'}}>
              <div style={{
                fontSize: '15px',
                color: '#86868b',
                marginBottom: '8px',
                fontWeight: '500'
              }}>
                Profit
              </div>
              <div style={{
                fontSize: '32px',
                fontWeight: '700',
                color: totals.profit >= 0 ? '#38a169' : '#e53e3e'
              }}>
                ${totals.profit.toFixed(2)}
              </div>
              <div style={{
                fontSize: '13px',
                color: totals.profit >= 0 ? '#68d391' : '#fc8181',
                fontWeight: '600',
                marginTop: '4px'
              }}>
                {totals.profitPct.toFixed(1)}% margin
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="form-actions" style={{
        padding: '24px',
        background: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #e5e5e7',
        textAlign: 'center'
      }}>
        <button 
          className="btn btn-primary" 
          onClick={onSave}
          style={{
            background: '#007aff',
            border: 'none',
            padding: '16px 32px',
            fontSize: '17px',
            fontWeight: '600',
            borderRadius: '12px',
            color: 'white',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          {row? "Update":"Save"} {kind==="quote"?"Quote":"Job"}
        </button>
      </div>
    </div>
  );
}