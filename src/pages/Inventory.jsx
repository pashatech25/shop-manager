import React, {useEffect, useState} from "react";
import {supabase} from "../lib/supabaseClient";
import {useTenant} from "../context/TenantContext";
import {toast} from "react-toastify";

export default function Inventory(){
  const {tenantId} = useTenant();
  const [materials,setMaterials] = useState([]);
  const [ledger,setLedger] = useState([]);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    let cancel=false;
    (async()=>{
      try{
        setLoading(true);
        if(!tenantId){ setMaterials([]); setLedger([]); return; }
        const m = await supabase.from("materials").select("id,name,on_hand,purchase_price,selling_price").eq("tenant_id", tenantId).order("name");
        const l = await supabase.from("inventory_ledger").select("*").eq("tenant_id", tenantId).order("created_at",{ascending:false}).limit(100);
        if(m.error) throw m.error;
        if(l.error) throw l.error;
        if(!cancel){ setMaterials(m.data||[]); setLedger(l.data||[]); }
      }catch(ex){ if(!cancel) toast.error(ex.message||"Failed to load inventory"); }
      finally{ if(!cancel) setLoading(false); }
    })();
    return ()=>{ cancel=true; };
  },[tenantId]);

  return (
    <section>
      <h2 className="m-0">Inventory</h2>
      {loading && <div>Loading…</div>}

      <div className="section" style={{marginTop:16}}>
        <h4>Materials</h4>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>On hand</th><th>Purchase</th><th>Selling</th></tr></thead>
            <tbody>
              {materials.map(m=>(
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.on_hand||0}</td>
                  <td>{Number(m.purchase_price||0).toFixed(2)}</td>
                  <td>{Number(m.selling_price||0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {materials.length===0 && <div className="tiny">No materials yet.</div>}
        </div>
      </div>

      <div className="section">
        <h4>Recent Ledger</h4>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Material</th><th>Qty</th><th>Reason</th><th>Ref</th></tr></thead>
            <tbody>
              {ledger.map(r=>(
                <tr key={r.id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.material_id}</td>
                  <td>{r.qty_delta>0?`+${r.qty_delta}`:r.qty_delta}</td>
                  <td>{r.reason}</td>
                  <td>{r.ref_type} {r.ref_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledger.length===0 && <div className="tiny">No ledger entries yet.</div>}
        </div>
      </div>
    </section>
  );
}
