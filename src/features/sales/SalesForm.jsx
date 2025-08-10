import React, {useEffect, useState} from "react";
import {useTenant} from "../../context/TenantContext";
import {supabase} from "../../lib/supabaseClient";
import {toast} from "react-toastify";
import {listTemplates} from "../templates/api";

export default function SalesForm({kind="quote", onSaved}){
  const {tenantId} = useTenant();

  // reference data (always arrays)
  const [loading,setLoading] = useState(true);
  const [err,setErr] = useState("");
  const [customers,setCustomers]   = useState([]);
  const [equipments,setEquipments] = useState([]);
  const [materials,setMaterials]   = useState([]);
  const [addons,setAddons]         = useState([]);
  const [tmplList,setTmplList]     = useState([]); // <= renamed from "templates"

  // minimal working state
  const [title,setTitle] = useState("");
  const [customerId,setCustomerId] = useState("");
  const [marginPct,setMarginPct] = useState(100);

  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        setLoading(true); setErr("");

        if(!tenantId){
          setCustomers([]); setEquipments([]); setMaterials([]); setAddons([]); setTmplList([]);
          return;
        }

        const q1 = supabase.from("customers")
          .select("id,name,company,email")
          .eq("tenant_id", tenantId)
          .order("name", {ascending:true});

        const q2 = supabase.from("equipments")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", {ascending:false});

        const q3 = supabase.from("materials")
          .select("id,name,on_hand,purchase_price,selling_price,type_id,vendor_id")
          .eq("tenant_id", tenantId)
          .order("name", {ascending:true});

        const q4 = supabase.from("addons")
          .select("id,name,description")
          .eq("tenant_id", tenantId)
          .order("created_at", {ascending:false});

        const [r1,r2,r3,r4, tpl] = await Promise.all([
          q1, q2, q3, q4, listTemplates(tenantId, kind)
        ]);

        if(r1.error) throw r1.error;
        if(r2.error) throw r2.error;
        if(r3.error) throw r3.error;
        if(r4.error) throw r4.error;
        if(tpl.error) throw tpl.error;

        if(cancel) return;

        setCustomers(Array.isArray(r1.data)? r1.data : []);
        setEquipments(Array.isArray(r2.data)? r2.data : []);
        setMaterials(Array.isArray(r3.data)? r3.data : []);
        setAddons(Array.isArray(r4.data)? r4.data : []);

        // tpl.data should be an array; guard anyway and normalize
        const arr = Array.isArray(tpl.data) ? tpl.data
                  : (tpl.data ? [tpl.data] : []);
        setTmplList(arr);
      }catch(ex){
        if(!cancel){ setErr(ex.message||"Failed to load reference data"); }
      }finally{
        if(!cancel){ setLoading(false); }
      }
    })();
    return ()=>{ cancel=true; };
  },[tenantId, kind]);

  const onSave = async ()=>{
    try{
      if(!tenantId) throw new Error("Tenant not resolved.");
      if(!title.trim()) throw new Error("Title is required.");
      if(!customerId) throw new Error("Select a customer.");

      const payload = {
        tenant_id: tenantId,
        title,
        customer_id: customerId,
        marginPct: Number(marginPct||0),
        items: {},
        totals: {},
        status: kind==="quote" ? "open" : "active"
      };

      const {data:codeRow, error:codeErr} = await supabase
        .rpc("allocate_code", {p_kind: kind, p_tenant_id: tenantId})
        .single();
      if(codeErr) throw codeErr;
      payload.code = codeRow?.code;

      const table = kind==="quote" ? "quotes" : "jobs";
      const {data,error} = await supabase.from(table).insert(payload).select("*").single();
      if(error) throw error;

      toast.success(`${kind==="quote"?"Quote":"Job"} created`);
      onSaved?.(data);
    }catch(ex){
      toast.error(ex.message||"Save failed");
    }
  };

  // absolute safety: never .map a non-array
  const safeTemplates  = Array.isArray(tmplList) ? tmplList : [];
  const safeCustomers  = Array.isArray(customers) ? customers : [];
  const safeEquipments = Array.isArray(equipments) ? equipments : [];
  const safeMaterials  = Array.isArray(materials) ? materials : [];
  const safeAddons     = Array.isArray(addons) ? addons : [];

  return (
    <div className="form-card">
      <div className="row">
        <h3 className="m-0">{kind==="quote"?"New Quote":"New Job"}</h3>
        <div className="btn-row">
          <select
            className="search"
            aria-label="Load Template"
            onChange={(e)=>{
              const id = e.target.value;
              const t = safeTemplates.find(x=>String(x.id)===String(id));
              if(t){
                // TODO: apply template payload
                toast.info(`Loaded template: ${t.name}`);
              }
            }}
          >
            <option value="">Load template…</option>
            {safeTemplates.map(t=>(
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="btn btn-outline-primary" onClick={()=>toast.info("TODO: Save current as template")}>
            Save as Template
          </button>
        </div>
      </div>

      {err && <div className="alert alert-danger">{String(err)}</div>}
      {loading && <div>Loading reference data…</div>}

      <div className="grid-3">
        <div className="group">
          <label>Title</label>
          <input value={title} onChange={(e)=>setTitle(e.target.value)} placeholder="e.g., Panel print 24x36"/>
        </div>

        <div className="group">
          <label>Customer</label>
          <select value={customerId} onChange={(e)=>setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {safeCustomers.map(c=>(
              <option key={c.id} value={c.id}>
                {c.company ? `${c.company} — ${c.name}` : c.name}
              </option>
            ))}
          </select>
          <span className="tiny">{safeCustomers.length} customers</span>
        </div>

        <div className="group">
          <label>Margin (%)</label>
          <input type="number" min="0" step="1" value={marginPct} onChange={(e)=>setMarginPct(e.target.value)} />
        </div>
      </div>

      <div className="grid-3" style={{marginTop:12}}>
        <div className="group">
          <label>Equipments (preview)</label>
          <div className="chips">
            {safeEquipments.slice(0,4).map(eq=>(
              <div className="chip" key={eq.id}><i className="fa-solid fa-screwdriver-wrench"/>{eq.name}</div>
            ))}
          </div>
          <span className="tiny">{safeEquipments.length} equipments</span>
        </div>

        <div className="group">
          <label>Materials (preview)</label>
          <div className="chips">
            {safeMaterials.slice(0,4).map(m=>(
              <div className="chip" key={m.id}><i className="fa-solid fa-boxes-stacked"/>{m.name}</div>
            ))}
          </div>
          <span className="tiny">{safeMaterials.length} materials</span>
        </div>

        <div className="group">
          <label>Add-ons (preview)</label>
          <div className="chips">
            {safeAddons.slice(0,4).map(a=>(
              <div className="chip" key={a.id}><i className="fa-solid fa-puzzle-piece"/>{a.name}</div>
            ))}
          </div>
          <span className="tiny">{safeAddons.length} add-ons</span>
        </div>
      </div>

      <div className="btn-row" style={{marginTop:16}}>
        <button className="btn btn-primary" onClick={onSave}>Save {kind==="quote"?"Quote":"Job"}</button>
      </div>
    </div>
  );
}
