import React, {useEffect, useMemo, useState} from "react";
import {supabase} from "../../lib/supabaseClient";
import {useTenant} from "../../context/TenantContext";
import {toast} from "react-toastify";

/**
 * FullSalesForm
 * - kind: 'quote' | 'job'
 * - onSaved?: (row) => void
 * Notes:
 * - No auto-template apply on mount.
 * - Basic line editors for equipments, materials, labor, add-ons.
 * - Computes totals client-side; persists JSON payload.
 */
export default function FullSalesForm({kind="quote", onSaved}){
  const {tenantId} = useTenant();

  // reference data
  const [loading,setLoading] = useState(true);
  const [err,setErr] = useState("");
  const [customers,setCustomers] = useState([]);
  const [equipments,setEquipments] = useState([]);
  const [materials,setMaterials] = useState([]);
  const [addons,setAddons] = useState([]);

  // form state
  const [title,setTitle] = useState("");
  const [customerId,setCustomerId] = useState("");
  const [marginPct,setMarginPct] = useState(100);

  // line items
  const [eqLines,setEqLines] = useState([]);       // {equipment_id, mode: 'flat'|'hourly', hours, rate, flat_fee}
  const [matLines,setMatLines] = useState([]);     // {material_id, qty}
  const [addonLines,setAddonLines] = useState([]); // {addon_id, qty, price}
  const [laborLines,setLaborLines] = useState([]); // {desc, hours, rate}

  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        setLoading(true); setErr("");
        if(!tenantId) return;

        const q1 = supabase.from("customers").select("id,name,company,email").eq("tenant_id",tenantId).order("name");
        const q2 = supabase.from("equipments").select("*").eq("tenant_id",tenantId).order("created_at",{ascending:false});
        const q3 = supabase.from("materials").select("id,name,on_hand,purchase_price,selling_price").eq("tenant_id",tenantId).order("name");
        const q4 = supabase.from("addons").select("id,name,description").eq("tenant_id",tenantId).order("created_at",{ascending:false});
        const [r1,r2,r3,r4] = await Promise.all([q1,q2,q3,q4]);

        if(r1.error) throw r1.error;
        if(r2.error) throw r2.error;
        if(r3.error) throw r3.error;
        if(r4.error) throw r4.error;

        if(cancel) return;
        setCustomers(r1.data||[]);
        setEquipments(r2.data||[]);
        setMaterials(r3.data||[]);
        setAddons(r4.data||[]);
      }catch(ex){
        if(!cancel) setErr(ex.message||"Failed to load reference data");
      }finally{
        if(!cancel) setLoading(false);
      }
    })();
    return ()=>{ cancel=true; };
  },[tenantId]);

  // ------- calculators -------
  const totals = useMemo(()=>{
    // materials
    let matCost = 0, matCharge = 0;
    matLines.forEach(l=>{
      const m = materials.find(x=>x.id===l.material_id);
      if(!m) return;
      const qty = Number(l.qty||0);
      matCost   += (Number(m.purchase_price||0) * qty);
      matCharge += (Number(m.selling_price||0) * qty);
    });

    // equipments (hourly or flat)
    let eqCharge = 0;
    eqLines.forEach(l=>{
      if(l.mode==="hourly"){
        eqCharge += Number(l.hours||0) * Number(l.rate||0);
      }else{
        eqCharge += Number(l.flat_fee||0);
      }
    });

    // labor
    let laborCharge = 0;
    laborLines.forEach(l=>{
      laborCharge += Number(l.hours||0) * Number(l.rate||0);
    });

    // add-ons
    let addonCharge = 0;
    addonLines.forEach(l=>{
      addonCharge += Number(l.qty||0) * Number(l.price||0);
    });

    // inks: for now treat as included in equipment (your advanced ink calc plugs here)

    const inkCost = 0; // placeholder (will be calculated later)
    const inkCharge = inkCost * (1 + Number(marginPct||0)/100);

    const totalCost   = matCost + inkCost; // cost doesn’t include markup things like labor/addons flat by design
    const totalCharge = matCharge + inkCharge + eqCharge + laborCharge + addonCharge;

    // tax from settings (we’ll leave 0 here; PDF/submit can fetch settings.tax_pct)
    const taxPct = 0;
    const tax = totalCharge * taxPct/100;
    const grand = totalCharge + tax;

    const profit = totalCharge - totalCost;
    const profitPct = totalCost>0 ? (profit/totalCost)*100 : 0;

    return {matCost, matCharge, eqCharge, laborCharge, addonCharge, inkCost, inkCharge, totalCost, totalCharge, taxPct, tax, grand, profit, profitPct};
  },[matLines, materials, eqLines, laborLines, addonLines, marginPct]);

  // ------- helpers -------
  const addEq  = ()=> setEqLines(v=>[...v,{equipment_id:"", mode:"hourly", hours:0, rate:0, flat_fee:0}]);
  const addMat = ()=> setMatLines(v=>[...v,{material_id:"", qty:1}]);
  const addAdd = ()=> setAddonLines(v=>[...v,{addon_id:"", qty:1, price:0}]);
  const addLab = ()=> setLaborLines(v=>[...v,{desc:"", hours:0, rate:0}]);

  const createDoc = async ()=>{
    try{
      if(!tenantId) throw new Error("Tenant not resolved.");
      if(!title.trim()) throw new Error("Title is required.");
      if(!customerId) throw new Error("Select a customer.");

      const {data:codeRow, error:codeErr} = await supabase.rpc("allocate_code",{p_kind:kind, p_tenant_id:tenantId}).single();
      if(codeErr) throw codeErr;

      const payload = {
        tenant_id: tenantId,
        code: codeRow?.code,
        title,
        customer_id: customerId,
        margin_pct: Number(marginPct||0),
        items: {
          equipments: eqLines,
          materials: matLines,
          addons: addonLines,
          labor: laborLines
        },
        totals,
        status: kind==="quote" ? "open" : "active"
      };

      const table = (kind==="quote") ? "quotes" : "jobs";
      const {data, error} = await supabase.from(table).insert(payload).select("*").single();
      if(error) throw error;

      toast.success(`${kind==="quote"?"Quote":"Job"} ${data.code} created`);
      onSaved?.(data);
    }catch(ex){
      console.error(ex);
      toast.error(ex.message||"Save failed");
    }
  };

  return (
    <div className="form-card">
      <div className="row">
        <h3 className="m-0">{kind==="quote"?"New Quote":"New Job"}</h3>
      </div>

      {err && <div className="alert alert-danger">{String(err)}</div>}
      {loading && <div>Loading reference data…</div>}

      <div className="grid-3">
        <div className="group">
          <label>Title</label>
          <input value={title} onChange={(e)=>setTitle(e.target.value)} />
        </div>
        <div className="group">
          <label>Customer</label>
          <select value={customerId} onChange={(e)=>setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map(c=>(
              <option key={c.id} value={c.id}>{c.company?`${c.company} — ${c.name}`:c.name}</option>
            ))}
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
        {eqLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Equipment</label>
                <select value={l.equipment_id} onChange={(e)=>{
                  const v=e.target.value; setEqLines(x=>x.map((it,i)=>i===idx?{...it,equipment_id:v}:it));
                }}>
                  <option value="">Select…</option>
                  {equipments.map(eq=><option key={eq.id} value={eq.id}>{eq.name}</option>)}
                </select>
              </div>
              <div className="group">
                <label>Mode</label>
                <select value={l.mode} onChange={(e)=>setEqLines(x=>x.map((it,i)=>i===idx?{...it,mode:e.target.value}:it))}>
                  <option value="hourly">Hourly</option>
                  <option value="flat">Flat fee</option>
                </select>
              </div>
              {l.mode==="hourly" ? (
                <>
                  <div className="group">
                    <label>Hours</label>
                    <input type="number" min="0" step="0.01" value={l.hours} onChange={(e)=>setEqLines(x=>x.map((it,i)=>i===idx?{...it, hours:e.target.value}:it))}/>
                  </div>
                  <div className="group">
                    <label>Rate</label>
                    <input type="number" min="0" step="0.01" value={l.rate} onChange={(e)=>setEqLines(x=>x.map((it,i)=>i===idx?{...it, rate:e.target.value}:it))}/>
                  </div>
                </>
              ) : (
                <div className="group">
                  <label>Flat Fee</label>
                  <input type="number" min="0" step="0.01" value={l.flat_fee} onChange={(e)=>setEqLines(x=>x.map((it,i)=>i===idx?{...it, flat_fee:e.target.value}:it))}/>
                </div>
              )}
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setEqLines(x=>x.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {eqLines.length===0 && <div className="tiny">No equipment added.</div>}
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
                <select value={l.material_id} onChange={(e)=>setMatLines(x=>x.map((it,i)=>i===idx?{...it, material_id:e.target.value}:it))}>
                  <option value="">Select…</option>
                  {materials.map(m=><option key={m.id} value={m.id}>{m.name} (on hand: {m.on_hand||0})</option>)}
                </select>
              </div>
              <div className="group">
                <label>Qty</label>
                <input type="number" min="0" step="1" value={l.qty} onChange={(e)=>setMatLines(x=>x.map((it,i)=>i===idx?{...it, qty:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setMatLines(x=>x.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {matLines.length===0 && <div className="tiny">No materials added.</div>}
      </div>

      {/* Add-ons */}
      <div className="section">
        <div className="section-header">
          <h4 className="m-0">Add-ons</h4>
          <button className="btn btn-outline-primary" onClick={addAdd}><i className="fa-solid fa-plus"/> Add</button>
        </div>
        {addonLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Add-on</label>
                <select value={l.addon_id} onChange={(e)=>setAddonLines(x=>x.map((it,i)=>i===idx?{...it, addon_id:e.target.value}:it))}>
                  <option value="">Select…</option>
                  {addons.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="group">
                <label>Qty</label>
                <input type="number" min="0" step="1" value={l.qty} onChange={(e)=>setAddonLines(x=>x.map((it,i)=>i===idx?{...it, qty:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Price</label>
                <input type="number" min="0" step="0.01" value={l.price} onChange={(e)=>setAddonLines(x=>x.map((it,i)=>i===idx?{...it, price:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setAddonLines(x=>x.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {addonLines.length===0 && <div className="tiny">No add-ons added.</div>}
      </div>

      {/* Labor */}
      <div className="section">
        <div className="section-header">
          <h4 className="m-0">Labor</h4>
          <button className="btn btn-outline-primary" onClick={addLab}><i className="fa-solid fa-plus"/> Add</button>
        </div>
        {laborLines.map((l,idx)=>(
          <div key={idx} className="card" style={{marginBottom:8}}>
            <div className="grid-3">
              <div className="group">
                <label>Description</label>
                <input value={l.desc} onChange={(e)=>setLaborLines(x=>x.map((it,i)=>i===idx?{...it, desc:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Hours</label>
                <input type="number" min="0" step="0.01" value={l.hours} onChange={(e)=>setLaborLines(x=>x.map((it,i)=>i===idx?{...it, hours:e.target.value}:it))}/>
              </div>
              <div className="group">
                <label>Rate</label>
                <input type="number" min="0" step="0.01" value={l.rate} onChange={(e)=>setLaborLines(x=>x.map((it,i)=>i===idx?{...it, rate:e.target.value}:it))}/>
              </div>
            </div>
            <div className="btn-row" style={{marginTop:8}}>
              <button className="btn btn-danger" onClick={()=>setLaborLines(x=>x.filter((_,i)=>i!==idx))}>Remove</button>
            </div>
          </div>
        ))}
        {laborLines.length===0 && <div className="tiny">No labor added.</div>}
      </div>

      {/* Totals */}
      <div className="card" style={{marginTop:12}}>
        <div className="grid-3">
          <div><strong>Cost (materials + ink):</strong><br/>{totals.totalCost.toFixed(2)}</div>
          <div><strong>Charge (pre-tax):</strong><br/>{totals.totalCharge.toFixed(2)}</div>
          <div><strong>Profit:</strong><br/>{totals.profit.toFixed(2)} ({totals.profitPct.toFixed(1)}%)</div>
        </div>
      </div>

      <div className="btn-row" style={{marginTop:16}}>
        <button className="btn btn-primary" onClick={createDoc}>Save {kind==="quote"?"Quote":"Job"}</button>
      </div>
    </div>
  );
}
