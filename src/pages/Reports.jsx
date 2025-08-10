import {useEffect, useMemo, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend} from 'recharts';

export default function Reports(){
  const {tenantId}=useTenant();
  const [from,setFrom]=useState(defaultFrom());
  const [to,setTo]=useState(todayStr());
  const [invoices,setInvoices]=useState([]);
  const [jobs,setJobs]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId) return;
      setLoading(true);
      const [{data:is},{data:js},{data:ms}] = await Promise.all([
        supabase.from('invoices').select('*').eq('tenant_id', tenantId).gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59'),
        supabase.from('jobs').select('*').eq('tenant_id', tenantId).gte('created_at', from+'T00:00:00').lte('created_at', to+'T23:59:59'),
        supabase.from('materials').select('id,name,on_hand,reserved,reorder_threshold').eq('tenant_id', tenantId)
      ]);
      setInvoices(is||[]); setJobs(js||[]); setMaterials(ms||[]);
      setLoading(false);
    };
    load();
  },[tenantId, from, to]);

  const revenueSeries=useMemo(()=>{
    const map={}; // yyyy-mm-dd -> sum
    for(const inv of invoices){
      const d=inv.created_at?.slice(0,10);
      const v=Number(inv.totals?.grandTotal ?? inv.totals?.totalAfterTax ?? 0);
      map[d]=(map[d]||0)+v;
    }
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).map(([d,v])=>({date:d, revenue:Number(v.toFixed(2))}));
  },[invoices]);

  const jobSeries=useMemo(()=>{
    const map={}; for(const j of jobs){ const d=j.created_at?.slice(0,10); map[d]=(map[d]||0)+1; }
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).map(([d,c])=>({date:d, jobs:c}));
  },[jobs]);

  const lowMaterials=useMemo(()=>{
    return (materials||[]).filter((m)=>(Number(m.on_hand||0)-Number(m.reserved||0))<=Number(m.reorder_threshold||0));
  },[materials]);

  const expenseBreakdown=useMemo(()=>{
    // Very rough: sum cost components from jobs (if totals snapshot exists)
    let ink=0, mats=0, labor=0, addons=0;
    for(const j of jobs){
      ink += Number(j.totals?.inkCostRaw||0);
      mats += Number(j.totals?.matCost||0);
      labor += Number(j.totals?.laborCharge||0);
      addons += Number(j.totals?.addonCharge||0);
    }
    return [
      {name:'Ink', value:to2(ink)},
      {name:'Materials', value:to2(mats)},
      {name:'Labor', value:to2(labor)},
      {name:'Add-ons', value:to2(addons)}
    ];
  },[jobs]);

  return (
    <section className="section">
      <div className="section-header">
        <h2>Reports</h2>
        <div className="row">
          <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/>
          <input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Revenue Over Time</h3>
          <div style={{width:'100%', height:280}}>
            <ResponsiveContainer>
              <LineChart data={revenueSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date"/><YAxis/><Tooltip/>
                <Line type="monotone" dataKey="revenue" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>Jobs per Day</h3>
          <div style={{width:'100%', height:280}}>
            <ResponsiveContainer>
              <BarChart data={jobSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date"/><YAxis/><Tooltip/>
                <Bar dataKey="jobs" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{marginTop:16}}>
        <div className="card">
          <h3>Expense Breakdown</h3>
          <div style={{width:'100%', height:280, display:'flex', justifyContent:'center'}}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={expenseBreakdown} dataKey="value" nameKey="name" outerRadius={100} label>
                  {expenseBreakdown.map((_,i)=> <Cell key={i} />)}
                </Pie>
                <Tooltip/><Legend/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3>Low Inventory</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>On Hand</th><th>Reserved</th><th>Threshold</th></tr></thead>
              <tbody>
                {lowMaterials.map((m)=>(
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.on_hand??0}</td>
                    <td>{m.reserved??0}</td>
                    <td>{m.reorder_threshold??0}</td>
                  </tr>
                ))}
                {lowMaterials.length===0? <tr><td colSpan={4} className="tiny">Nothing low right now.</td></tr>:null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function defaultFrom(){ const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function to2(n){ return Number((+n||0).toFixed(2)); }
