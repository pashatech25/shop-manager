import React,{useEffect,useMemo,useState} from "react";
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
  const [marginPct,setMarginPct]=useState(100); // applies to UV/Sublimation ink cost only

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

  const UV_SET=new Set(["uv printer","sublimation printer"]);

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

  const equipById=useMemo(()=>{ const m=new Map(); for(const e of equipments) m.set(e.id,e); return m; },[equipments]);
  const matById=useMemo(()=>{ const m=new Map(); for(const x of materials) m.set(x.id,x); return m; },[materials]);

  // ------- MONEY: compute full totals to persist -------
  const computeTotals=()=>{
    let matCost=0, matCharge=0;
    for(const l of matLines){
      const m=matById.get(l.material_id);
      if(!m) continue;
      const qty=Number(l.qty||0);
      matCost += Number(m.purchase_price||0) * qty;
      matCharge += Number(m.selling_price||0) * qty;
    }

    let eqCharge=0;            // non-UV manual equipment charges
    let laborCharge=0;
    let addonCharge=0;

    for(const l of laborLines){
      laborCharge += Number(l.hours||0) * Number(l.rate||0);
    }
    for(const l of addonLines){
      addonCharge += Number(l.qty||0) * Number(l.price||0);
    }

    // Ink math (UV/Sublimation)
    let inkBaseCost=0;
    for(const l of eqLines){
      const eq = l.equipment_id? equipById.get(l.equipment_id):null;
      const type=(eq?.type || l.type || "").toLowerCase();
      const isUV = UV_SET.has(type);

      if(isUV){
        // per-mL rates on equipment (numbers or 0)
        const rates = eq?.ink_rates || {};
        const inks  = l.inks || {};
        const whiteKey = l.use_soft_white ? "soft_white" : "white";

        const c = Number(inks.c||0) * Number(rates.c||0);
        const m = Number(inks.m||0) * Number(rates.m||0);
        const y = Number(inks.y||0) * Number(rates.y||0);
        const k = Number(inks.k||0) * Number(rates.k||0);
        const w = Number(inks[whiteKey]||0) * Number(rates[whiteKey]||0);
        const g = Number(inks.gloss||0) * Number(rates.gloss||0);

        inkBaseCost += c+m+y+k+w+g;
      }else{
        // non-UV equipment = hourly/flat fee contributes to eqCharge
        if(l.mode==="hourly") eqCharge += Number(l.hours||0) * Number(l.rate||0);
        else eqCharge += Number(l.flat_fee||0);
      }
    }

    const inkCharge = inkBaseCost * (1 + Number(marginPct||0)/100);

    const totalCost    = matCost + inkBaseCost;
    const totalCharge  = matCharge + inkCharge + eqCharge + laborCharge + addonCharge;

    // tax from settings will be applied at invoice stage; keep 0 here to avoid double-applying
    const taxPct = 0, tax=0, grand=totalCharge;
    const profit = totalCharge - totalCost;
    const profitPct = totalCost>0? (profit/totalCost)*100 : 0;

    return {matCost,matCharge,eqCharge,laborCharge,addonCharge,inkCost:inkBaseCost,inkCharge,totalCost,totalCharge,taxPct,tax,grand,profit,profitPct};
  };

  // live preview (same as computeTotals but memoized for UI)
  const totals=useMemo(()=>computeTotals(),[materials,matLines,eqLines,laborLines,addonLines,marginPct,equipments]);

  const flipWhiteVariant=(line, useSW)=>{
    const inks=line.inks||{};
    return {...line, use_soft_white:useSW, inks:{...inks}};
  };

  // ---------- save (insert or update) ----------
  const onSave=async ()=>{
    try{
      if(!tenantId) throw new Error("Tenant not resolved");
      if(!title.trim()) throw new Error("Title is required");
      if(!customerId) throw new Error("Select a customer");
      const table=(kind==="quote")? "quotes":"jobs";

      const fullTotals = computeTotals();

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
        totals: fullTotals
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
    }catch(ex){
      console.error(ex);
      toast.error(ex.message||"Save failed");
    }
  };

  return (
    <div className="form-card">
      <div className="row">
        <h3 className="m-0">{row? (kind==="quote"?"Edit Quote":"Edit Job") : (kind==="quote"?"New Quote":"New Job")}</h3>
      </div>

      {err? <div className="alert alert-danger">{String(err)}</div> : null}
      {loading? <div>Loading reference data…</div> : null}

      {/* Header fields */}
      <div className="grid-3">
        <div className="group">
          <label>Title</label>
          <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="e.g., Panel print 24×36"/>
        </div>
        <div className="group">
          <label>Customer</label>
          <select value={customerId} onChange={(e)=>setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map((c)=>(<option key={c.id} value={c.id}>{c.company? `${c.company} — ${c.name}`:c.name}</option>))}
          </select>
        </div>
        <div className="group">
          <label>Ink Margin (%)</label>
          <input type="number" min="0" step="1" value={marginPct} onChange={(e)=>setMarginPct(e.target.value)} />
        </div>
      </div>

      {/* Equipments */}
      <div className="section" style={{marginTop:16}}>
        <div className="section-header">
          <h4 className="m-0">Equipments</h4>
          <button className="btn btn-outline-primary" onClick={addEq}><i className="fa-solid fa-plus"/> Add</button>
        </div>

        {eqLines.map((l,idx)=>{
          const selected=l.equipment_id? equipById.get(l.equipment_id):null;
          const typeRaw=selected?.type || l.type || "";
          const type=(typeRaw||"").toLowerCase();
          const isUV=UV_SET.has(type);

          return (
            <div key={idx} className="card" style={{marginBottom:8}}>
              <div className="grid-3">
                <div className="group">
                  <label>Equipment</label>
                  <select
                    value={l.equipment_id}
                    onChange={(e)=>{
                      const id=e.target.value;
                      const sel=id? equipById.get(id):null;
                      const t=sel?.type || "";
                      const useSW=!!sel?.use_soft_white;
                      setEqLines((xs)=>xs.map((it,i)=> i===idx
                        ? {...it, equipment_id:id, type:t, use_soft_white:useSW, inks:{...it.inks}}
                        : it
                      ));
                    }}
                  >
                    <option value="">Select…</option>
                    {equipments.map((eq)=>(
                      <option key={eq.id} value={eq.id}>{eq.name} {eq.type?`(${eq.type})`:""}</option>
                    ))}
                  </select>
                </div>
                <div className="group">
                  <label>Type</label>
                  <input value={typeRaw} readOnly />
                </div>

                {!isUV ? (
                  <div className="group">
                    <label>Mode</label>
                    <select value={l.mode} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, mode:e.target.value}:it))}>
                      <option value="hourly">Hourly</option>
                      <option value="flat">Flat fee</option>
                    </select>
                  </div>
                ) : (
                  <div className="group">
                    <label>White vs Soft White</label>
                    <select
                      value={l.use_soft_white? "soft_white":"white"}
                      onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? flipWhiteVariant(it, e.target.value==="soft_white"):it))}
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
                    <div className="grid-3">
                      <div className="group">
                        <label>Hours</label>
                        <input type="number" min="0" step="0.01" value={l.hours} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, hours:e.target.value}:it))}/>
                      </div>
                      <div className="group">
                        <label>Rate</label>
                        <input type="number" min="0" step="0.01" value={l.rate} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, rate:e.target.value}:it))}/>
                      </div>
                    </div>
                  ):(
                    <div className="group">
                      <label>Flat Fee</label>
                      <input type="number" min="0" step="0.01" value={l.flat_fee} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, flat_fee:e.target.value}:it))}/>
                    </div>
                  )}
                </>
              ):(
                <div className="ink-inputs" style={{marginTop:8}}>
                  <div className="group">
                    <label><span className="ink-color-box" style={{background:"#00b5ff"}}/> Cyan (ml)</label>
                    <input type="number" step="0.0001" min="0" value={l.inks.c} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, c:e.target.value}}:it))}/>
                  </div>
                  <div className="group">
                    <label><span className="ink-color-box" style={{background:"#ff3ea5"}}/> Magenta (ml)</label>
                    <input type="number" step="0.0001" min="0" value={l.inks.m} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, m:e.target.value}}:it))}/>
                  </div>
                  <div className="group">
                    <label><span className="ink-color-box" style={{background:"#ffd400"}}/> Yellow (ml)</label>
                    <input type="number" step="0.0001" min="0" value={l.inks.y} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, y:e.target.value}}:it))}/>
                  </div>
                  <div className="group">
                    <label><span className="ink-color-box" style={{background:"#000"}}/> Black (ml)</label>
                    <input type="number" step="0.0001" min="0" value={l.inks.k} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, k:e.target.value}}:it))}/>
                  </div>

                  {l.use_soft_white? (
                    <div className="group">
                      <label><span className="ink-color-box" style={{background:"#f0f0f0", border:"1px solid #ddd"}}/> Soft White (ml)</label>
                      <input type="number" step="0.0001" min="0" value={l.inks.soft_white} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, soft_white:e.target.value}}:it))}/>
                    </div>
                  ):(
                    <div className="group">
                      <label><span className="ink-color-box" style={{background:"#fff", border:"1px solid #ddd"}}/> White (ml)</label>
                      <input type="number" step="0.0001" min="0" value={l.inks.white} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, white:e.target.value}}:it))}/>
                    </div>
                  )}

                  <div className="group">
                    <label><span className="ink-color-box" style={{background:"#cfcfcf"}}/> Gloss (ml)</label>
                    <input type="number" step="0.0001" min="0" value={l.inks.gloss} onChange={(e)=>setEqLines((xs)=>xs.map((it,i)=>i===idx? {...it, inks:{...it.inks, gloss:e.target.value}}:it))}/>
                  </div>
                </div>
              )}

              <div className="btn-row" style={{marginTop:8}}>
                <button className="btn btn-danger" onClick={()=>setEqLines((xs)=>xs.filter((_,i)=>i!==idx))}>Remove</button>
              </div>
            </div>
          );
        })}

        {eqLines.length===0? <div className="tiny">No equipment added.</div> : null}
      </div>

      {/* Materials */}
      <div className="section">
        <div className="section-header">
          <h4 className="m-0">Materials</h4>
          <button className="btn btn-outline-primary" onClick={addMat}><i className="fa-solid fa-plus"/> Add</button>
        </div>
        {matLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Material</label>
                <select value={l.material_id} onChange={(e)=>setMatLines((xs)=>xs.map((it,i)=>i===idx? {...it, material_id:e.target.value}:it))}>
                  <option value="">Select…</option>
                  {materials.map((m)=>(<option key={m.id} value={m.id}>{m.name} (on hand: {m.on_hand||0})</option>))}
                </select>
              </div>
              <div className="group">
                <label>Qty</label>
                <input type="number" min="0" step="1" value={l.qty} onChange={(e)=>setMatLines((xs)=>xs.map((it,i)=>i===idx? {...it, qty:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setMatLines((xs)=>xs.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {matLines.length===0? <div className="tiny">No materials added.</div> : null}
      </div>

      {/* Add-ons */}
      <div className="section">
        <div className="section-header">
          <h4 className="m-0">Add-ons</h4>
          <button className="btn btn-outline-primary" onClick={addAddon}><i className="fa-solid fa-plus"/> Add</button>
        </div>
        {addonLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Add-on</label>
                <select value={l.addon_id} onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, addon_id:e.target.value}:it))}>
                  <option value="">Select…</option>
                  {addons.map((a)=>(<option key={a.id} value={a.id}>{a.name}</option>))}
                </select>
              </div>
              <div className="group">
                <label>Qty</label>
                <input type="number" min="0" step="1" value={l.qty} onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, qty:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Price</label>
                <input type="number" min="0" step="0.01" value={l.price} onChange={(e)=>setAddonLines((xs)=>xs.map((it,i)=>i===idx? {...it, price:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setAddonLines((xs)=>xs.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {addonLines.length===0? <div className="tiny">No add-ons added.</div> : null}
      </div>

      {/* Labor */}
      <div className="section">
        <div className="section-header">
          <h4 className="m-0">Labor</h4>
          <button className="btn btn-outline-primary" onClick={addLabor}><i className="fa-solid fa-plus"/> Add</button>
        </div>
        {laborLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Description</label>
                <input value={l.desc} onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, desc:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Hours</label>
                <input type="number" min="0" step="0.01" value={l.hours} onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, hours:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Rate</label>
                <input type="number" min="0" step="0.01" value={l.rate} onChange={(e)=>setLaborLines((xs)=>xs.map((it,i)=>i===idx? {...it, rate:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setLaborLines((xs)=>xs.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {laborLines.length===0? <div className="tiny">No labor added.</div> : null}
      </div>

      {/* Totals preview */}
      <div className="card" style={{marginTop:12}}>
        <div className="grid-3">
          <div><strong>Ink (with margin):</strong><br/>${totals.inkCharge.toFixed(2)}</div>
          <div><strong>Materials charge:</strong><br/>${totals.matCharge.toFixed(2)}</div>
          <div><strong>Equipment charge:</strong><br/>${totals.eqCharge.toFixed(2)}</div>
          <div><strong>Labor:</strong><br/>${totals.laborCharge.toFixed(2)}</div>
          <div><strong>Add-ons:</strong><br/>${totals.addonCharge.toFixed(2)}</div>
          <div><strong>Pre-tax total:</strong><br/>${totals.totalCharge.toFixed(2)}</div>
          <div><strong>Profit:</strong><br/>${totals.profit.toFixed(2)} ({totals.profitPct.toFixed(1)}%)</div>
        </div>
      </div>

      <div className="btn-row" style={{marginTop:16}}>
        <button className="btn btn-primary" onClick={onSave}>
          {row? "Update":"Save"} {kind==="quote"?"Quote":"Job"}
        </button>
      </div>
    </div>
  );
}
