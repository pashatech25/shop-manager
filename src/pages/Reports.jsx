// src/pages/Reports.jsx
import {useEffect, useMemo, useRef, useState} from 'react';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import {captureElementToPdf} from '../features/pdf/service.js';

export default function Reports(){
  const {tenantId}=useTenant();

  const [from,setFrom]=useState(defaultFrom());
  const [to,setTo]=useState(todayStr());

  const [invoices,setInvoices]=useState([]);
  const [jobs,setJobs]=useState([]);
  const [materials,setMaterials]=useState([]);
  const [completedJobs,setCompletedJobs]=useState([]);

  const [loading,setLoading]=useState(true);

  // PDF preview modal
  const [pdfUrl,setPdfUrl]=useState(null);
  const printRef=useRef(null);

  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId) return;
      setLoading(true);
      const [invRes, jobsRes, matsRes, cjobsRes] = await Promise.all([
        supabase.from('invoices')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('created_at', from+'T00:00:00')
          .lte('created_at', to+'T23:59:59'),
        supabase.from('jobs')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('created_at', from+'T00:00:00')
          .lte('created_at', to+'T23:59:59'),
        supabase.from('materials')
          .select('id,name,on_hand,reserved,reorder_threshold')
          .eq('tenant_id', tenantId),
        // Completed jobs for the PDF report
        supabase.from('completed_jobs')
          .select('*')
          .eq('tenant_id', tenantId)
          .gte('completed_at', from+'T00:00:00')
          .lte('completed_at', to+'T23:59:59')
      ]);

      setInvoices(invRes.data||[]);
      setJobs(jobsRes.data||[]);
      setMaterials(matsRes.data||[]);
      setCompletedJobs(cjobsRes.data||[]);
      setLoading(false);
    };
    load();
  },[tenantId, from, to]);

  // Revenue = safe after-tax total snapshot (falls back to other common keys)
  const revenueSeries=useMemo(()=>{
    const map={}; // yyyy-mm-dd -> sum
    for(const inv of invoices){
      const d = (inv.created_at||'').slice(0,10);
      const t = inv?.totals||{};
      // Try the most accurate keys first; fall back safely.
      const value =
        num(t.grand) ??
        num(t.grandTotal) ??
        // if no grand snapshot, approximate: totalAfterTax or totalChargePreTax+tax
        (num(t.totalAfterTax) ?? (num(t.totalChargePreTax) + num(t.tax)));
      if(!d) continue;
      map[d]=(map[d]||0)+value;
    }
    return Object.entries(map)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([d,v])=>({date:d, revenue:to2(v)}));
  },[invoices]);

  // Jobs per day — prefer completed jobs, fall back to created jobs
const jobSeries = useMemo(()=>{
  const bump = (map, date)=>{ if(!date) return; map[date]=(map[date]||0)+1; };

  const byDay = {};

  // Prefer completed jobs in the range
  for(const j of completedJobs||[]){
    const d = (j.completed_at||'').slice(0,10);
    bump(byDay, d);
  }

  // If none completed, fall back to created jobs in the range
  if(Object.keys(byDay).length===0){
    for(const j of jobs||[]){
      const d = (j.created_at||'').slice(0,10);
      bump(byDay, d);
    }
  }

  return Object.entries(byDay)
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([d,c])=>({date:d, jobs:c}));
}, [completedJobs, jobs]);


  // Low materials table (kept as-is)
  const lowMaterials=useMemo(()=>{
    return (materials||[]).filter((m)=>(Number(m.on_hand||0)-Number(m.reserved||0))<=Number(m.reorder_threshold||0));
  },[materials]);

  // Expense breakdown — compute from completed job snapshots (totals), fall back safely
const expenseBreakdown = useMemo(()=>{
  let ink=0, mats=0, labor=0, addons=0;

  // Prefer completed jobs because they carry finalized totals
  const src = (completedJobs && completedJobs.length>0) ? completedJobs : jobs;

  for(const j of src||[]){
    const t = j?.totals || {};
    // common keys in your app with fallbacks
    ink   += Number(t.inkCost ?? t.ink_cost ?? t.inkCostRaw ?? 0) || 0;
    mats  += Number(t.matCost ?? t.materialsCost ?? 0) || 0;
    labor += Number(t.laborCharge ?? t.labor_cost ?? 0) || 0;
    addons+= Number(t.addonCharge ?? t.addons_cost ?? 0) || 0;
  }

  const data = [
    {name:'Ink',       value: Number(ink.toFixed(2))},
    {name:'Materials', value: Number(mats.toFixed(2))},
    {name:'Labor',     value: Number(labor.toFixed(2))},
    {name:'Add-ons',   value: Number(addons.toFixed(2))}
  ];
  return data;
}, [completedJobs, jobs]);


  // Generate PDF of completed jobs in range
  const generatePdf = async ()=>{
    try{
      if(!printRef.current){
        alert('Printable element not ready'); return;
      }
      // Build the HTML table from completedJobs
      printRef.current.innerHTML = renderCompletedJobsHTML({
        completed: completedJobs||[], from, to
      });

      const code = `completed-jobs-${from}_to_${to}`;
      const {url} = await captureElementToPdf({
        element: printRef.current,
        tenantId,
        kind: 'reports',
        code
      });
      setPdfUrl(url);
    }catch(err){
      console.error(err);
      alert(err.message||'Failed to generate PDF');
    }
  };

  return (
    <section className="section">
      <div className="section-header">
        <h2>Reports</h2>
        <div className="row">
          <input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/>
          <input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/>
          <button className="btn" onClick={generatePdf} disabled={loading}>
            <i className="fa-regular fa-file-pdf" /> Export PDF
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Revenue Over Time</h3>
          <div style={{width:'100%', height:280}}>
            <ResponsiveContainer>
              <LineChart data={revenueSeries.length? revenueSeries : [{date:'—', revenue:0}]}>
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
              <BarChart data={jobSeries.length? jobSeries : [{date:'—', jobs:0}]}>
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
            {expenseBreakdown.reduce((s,x)=>s+x.value,0)===0 ? (
              <div className="tiny" style={{alignSelf:'center'}}>No data yet for this range.</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="value" nameKey="name" outerRadius={100} label>
                    {expenseBreakdown.map((_,i)=> <Cell key={i} />)}
                  </Pie>
                  <Tooltip/><Legend/>
                </PieChart>
              </ResponsiveContainer>
            )}
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

      {/* Hidden print surface for PDF capture */}
      <div ref={printRef} style={{position:'fixed', left:-9999, top:-9999}} />

      {/* Simple PDF preview modal (same visual style as the rest of the app) */}
      {pdfUrl ? (
        <div className="modal" onClick={()=>setPdfUrl(null)}>
          <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
            <div className="row">
              <b>Report PDF</b>
              <div className="btn-row">
                <a className="btn" href={pdfUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button className="btn btn-secondary" onClick={()=>setPdfUrl(null)}>Close</button>
              </div>
            </div>
            <iframe
              title="report-pdf"
              src={pdfUrl}
              style={{width:'100%', height:'70vh', border:'1px solid #eee', borderRadius:8}}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** ---------- helpers ---------- */
function defaultFrom(){ const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function to2(n){ return Number((+n||0).toFixed(2)); }
function num(n){ const v=Number(n); return Number.isFinite(v)? v : 0; }

/** Build a compact printable HTML for completed jobs in range */
function renderCompletedJobsHTML({completed, from, to}){
  const rows = (completed||[]).map((j)=>{
    const t = j.totals || {};
    const items = j.items || {};
    // Basic summaries for table cells
    const eqCount = Array.isArray(items.equipments)? items.equipments.length : 0;
    const matCount= Array.isArray(items.materials)? items.materials.length : 0;
    const addCount= Array.isArray(items.addons)? items.addons.length : 0;

    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${esc(j.code||'')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${esc(j.title||'')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${esc((j.customer_name||'')||(j.customer?.name||''))}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:center">${eqCount}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:center">${matCount}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:center">${addCount}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:right">$${to2(t.totalCharge ?? t.totalChargePreTax ?? 0).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:right">$${to2(t.tax ?? 0).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee; text-align:right">$${to2(t.grand ?? t.totalAfterTax ?? 0).toFixed(2)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${esc((j.completed_at||'').slice(0,10))}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="font-family: Arial, sans-serif; padding:24px; width:900px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px">
        <div>
          <h2 style="margin:0 0 4px">Completed Jobs Report</h2>
          <div style="color:#666; font-size:12px">Range: ${esc(from)} → ${esc(to)}</div>
        </div>
        <div style="text-align:right; color:#666; font-size:12px">${new Date().toLocaleString()}</div>
      </div>
      <div style="height:1px; background:#eee; margin:10px 0 16px"></div>
      <table style="width:100%; border-collapse:collapse; font-size:13px">
        <thead>
          <tr style="background:#f6f7f9">
            <th style="text-align:left; padding:8px;">Job #</th>
            <th style="text-align:left; padding:8px;">Title</th>
            <th style="text-align:left; padding:8px;">Customer</th>
            <th style="text-align:center; padding:8px;">Equip</th>
            <th style="text-align:center; padding:8px;">Materials</th>
            <th style="text-align:center; padding:8px;">Add-ons</th>
            <th style="text-align:right; padding:8px;">Pre-Tax</th>
            <th style="text-align:right; padding:8px;">Tax</th>
            <th style="text-align:right; padding:8px;">Total</th>
            <th style="text-align:left; padding:8px;">Completed</th>
          </tr>
        </thead>
        <tbody>
          ${rows || ''}
          ${!rows ? `<tr><td colspan="10" style="padding:10px; color:#666">No completed jobs in this range.</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  `;
}
function esc(s){ return String(s||'').replace(/[&<>"']/g,(m)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m])); }
