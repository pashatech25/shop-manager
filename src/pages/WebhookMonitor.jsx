import {useEffect, useRef, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';

export default function WebhookMonitor(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const channelRef=useRef(null);

  useEffect(()=>{
    let active=true;
    const init=async ()=>{
      const {data}=await supabase.from('webhook_deliveries').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false}).limit(50);
      if(!active) return;
      setRows(data||[]);
    };
    if(tenantId){ init(); }
    return ()=>{ active=false; };
  },[tenantId]);

  useEffect(()=>{
    if(channelRef.current){ supabase.removeChannel(channelRef.current); channelRef.current=null; }
    if(!tenantId) return;
    const ch=supabase.channel(`wh-${tenantId}`)
      .on('postgres_changes', {event:'INSERT', schema:'public', table:'webhook_deliveries', filter:`tenant_id=eq.${tenantId}`}, (p)=> setRows((xs)=>[p.new, ...xs].slice(0,200)))
      .on('postgres_changes', {event:'UPDATE', schema:'public', table:'webhook_deliveries', filter:`tenant_id=eq.${tenantId}`}, (p)=> setRows((xs)=> xs.map((x)=>x.id===p.new.id?p.new:x)))
      .subscribe();
    channelRef.current=ch;
    return ()=>{ if(channelRef.current){ supabase.removeChannel(channelRef.current); channelRef.current=null; } };
  },[tenantId]);

  return (
    <section className="section">
      <div className="section-header"><h2>Webhook Monitor</h2><span className="tiny">{rows.length} recent</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Attempts</th><th>Endpoint</th></tr></thead>
          <tbody>
            {rows.map((r)=>(
              <tr key={r.id}>
                <td className="tiny">{fmt(r.created_at)}</td>
                <td className="tiny">{r.event||'—'}</td>
                <td><span className="badge">{r.status}</span></td>
                <td>{r.attempts??0}</td>
                <td className="tiny">{r.endpoint||'—'}</td>
              </tr>
            ))}
            {rows.length===0? <tr><td colSpan={5} className="tiny">No data yet.</td></tr>:null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmt(s){ try{ return new Date(s).toLocaleString(); }catch{ return s||''; } }
