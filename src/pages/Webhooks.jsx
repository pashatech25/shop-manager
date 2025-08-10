import {useEffect, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';

export default function Webhooks(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId) return;
      setLoading(true);
      const {data}=await supabase.from('webhook_deliveries')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at',{ascending:false})
        .limit(50);
      setRows(data||[]);
      setLoading(false);
    };
    load();
  },[tenantId]);

  const retry=async (r)=>{
    if(!confirm('Retry delivery?')) return;
    const {error}=await supabase.from('webhook_deliveries').update({status:'queued', attempts:(r.attempts||0)+1}).eq('id', r.id);
    if(error) return alert(error.message);
    alert('Queued for retry.');
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Webhooks</h2>
        {loading? <span className="tiny">Loading…</span>: <span className="tiny">{rows.length} deliveries</span>}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Event</th><th>Status</th><th>Attempts</th><th>Last Error</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
          <tbody>
            {rows.map((r)=>(
              <tr key={r.id}>
                <td className="tiny">{r.event||'—'}</td>
                <td><span className="badge">{r.status}</span></td>
                <td>{r.attempts??0}</td>
                <td className="tiny" style={{maxWidth:420, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{r.last_error||'—'}</td>
                <td style={{textAlign:'right'}}>
                  <div className="btn-row" style={{justifyContent:'flex-end'}}>
                    {r.status!=='delivered'? <button className="btn" onClick={()=>retry(r)}>Retry</button> : null}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length===0? <tr><td colSpan={5} className="tiny">No deliveries yet.</td></tr>:null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
