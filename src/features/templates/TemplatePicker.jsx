import React, {useEffect, useState} from "react";
import {listTemplates} from "./api";
import {useTenant} from "../../context/TenantContext";

export default function TemplatePicker({kind="quote", onPick}){
  const {tenantId} = useTenant();
  const [items,setItems] = useState([]);

  useEffect(()=>{
    let cancel=false;
    (async()=>{
      const {data,error} = await listTemplates(tenantId, kind);
      if(!cancel){
        if(error) console.error(error);
        setItems(data||[]);
      }
    })();
    return ()=>{ cancel=true; };
  },[tenantId, kind]);

  return (
    <select className="search" onChange={(e)=>{
      const t = items.find(x=>x.id===e.target.value);
      if(t && onPick) onPick(t);
    }}>
      <option value="">Load template…</option>
      {items.map(t=>(
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}
