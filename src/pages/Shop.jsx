import React, {useEffect, useMemo, useState} from "react";
import {supabase} from "../lib/supabaseClient";
import {useTenant} from "../context/TenantContext";
import {toast} from "react-toastify";
import EquipmentForm from "../features/equipment/EquipmentForm.jsx";

const EQUIP_TYPES = [
  "UV Printer",
  "Sublimation Printer",
  "3D Printer",
  "Co2 Laser",
  "Fiber Laser",
  "Diode Laser",
  "Mopa Laser",
  "UV Laser",
  "Vinyl Cutter",
  "CNC",
  "Others"
];

export default function Shop(){
  const {tenantId} = useTenant();
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [items,setItems] = useState([]);
  const [editing,setEditing] = useState(null); // equipment row or null
  const [open,setOpen] = useState(false);

  const load = async ()=>{
    try{
      setLoading(true);
      if(!tenantId){ setItems([]); setLoading(false); return; }
      const {data,error} = await supabase
        .from("equipments")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", {ascending:false});
      if(error) throw error;
      setItems(data||[]);
    }catch(ex){ setError(ex.message||"Failed to load equipments"); }
    finally{ setLoading(false); }
  };

  useEffect(()=>{ load(); },[tenantId]);

  const onCreate = ()=>{
    setEditing(null);
    setOpen(true);
  };
  const onEdit = (row)=>{
    setEditing(row);
    setOpen(true);
  };
  const onClose = ()=>{
    setOpen(false);
    setEditing(null);
  };
  const onSaved = ()=>{
    onClose();
    load();
  };

  const lasers = useMemo(()=>EQUIP_TYPES.filter((t)=>t.toLowerCase().includes("laser")),[]);

  const remove = async (id)=>{
    if(!confirm("Delete this equipment?")) return;
    try{
      const {error} = await supabase.from("equipments").delete().eq("id", id).eq("tenant_id", tenantId);
      if(error) throw error;
      toast.success("Equipment deleted");
      setItems((arr)=>arr.filter((x)=>x.id!==id));
    }catch(ex){ toast.error(ex.message||"Delete failed"); }
  };

  return (
    <section id="shop-section">
      <div className="d-flex align-items-center justify-content-between">
        <h2 className="m-0">Shop â€" Equipment</h2>
        <button className="btn btn-primary new-button" onClick={onCreate}>New Equipment</button>
      </div>

      {!tenantId && (
        <div className="alert alert-warning mt-3">
          No tenant context. Ensure your profile is linked to a tenant or set <code>VITE_DEFAULT_TENANT_ID</code> for local testing.
        </div>
      )}

      {open && (
        <div className="mt-3">
          <EquipmentForm
            tenantId={tenantId}
            initial={editing}
            onClose={onClose}
            onSaved={onSaved}
          />
        </div>
      )}

      {loading && <div className="shadow-box mt-3">Loading equipmentsâ€¦</div>}
      {error && <div className="alert alert-danger mt-3">{error}</div>}

      <div id="shop-list" className="mt-3">
        {(!loading && items.length > 0) && (
          <div className="table-responsive">
            <table className="table table-striped table-bordered">
              <thead className="table-dark">
                <tr>
                  <th>Equipment Name & Type</th>
                  <th>Description</th>
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((eq)=>(
                  <tr key={eq.id}>
                    <td>
                      <h5 className="mb-1">{eq.name}</h5>
                      <small className="text-muted">({eq.type})</small>
                    </td>
                    <td>
                      {eq.description && <div className="text-muted small">{eq.description}</div>}
                    </td>
                    <td>
                      {(eq.type==="UV Printer" || eq.type==="Sublimation Printer") && (
                        <div className="small">
                          <strong>Ink threshold:</strong> {eq.threshold_pct ?? 20}%
                          <div className="d-flex gap-2 mt-1 flex-wrap">
                            {["c","m","y","k","gloss","white","soft_white"].map((c)=>{
                              const key = c==="soft_white"?"ink_level_soft_white":(c==="gloss"?"ink_level_gloss":`ink_level_${c}`);
                              const val = eq[key];
                              if(val==null) return null;
                              const label = c==="soft_white"?"Soft White":(c==="gloss"?"Gloss":c.toUpperCase());
                              return <span key={c} className={`badge ${val<=eq.threshold_pct?"bg-danger":"bg-secondary"}`}>{label}: {val}%</span>;
                            })}
                            {eq.use_soft_white!=null && (
                              <span className="badge bg-info">{eq.use_soft_white ? "Using Soft White" : "Using White"}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {lasers.includes(eq.type) && (
                        <div className="small">
                          <strong>Laser details:</strong> Power & brand are captured in description for now.
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={()=>onEdit(eq)}>Edit</button>
                        <button className="btn btn-sm btn-outline-danger" onClick={()=>remove(eq.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(!loading && items.length===0 && tenantId) && (
          <div className="shadow-box">No equipment yet. Click â€œNew Equipmentâ€.</div>
        )}
      </div>
    </section>
  );
}