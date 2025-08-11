// src/pages/Dashboard.jsx
import {useEffect,useMemo,useState} from "react";
import {supabase} from "../lib/superbase.js";
import {useTenant} from "../context/TenantContext.jsx";

const UVLIKE=new Set(["uv printer","sublimation printer"]);

// ---------- helpers ----------
const num = (v, d=0)=> {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const safeJSON = (v)=>{
  if(!v) return null;
  if(typeof v==='object') return v;
  try{ return JSON.parse(v); }catch{ return null; }
};

// pull pre-tax subtotal from totals blob
function extractPreTax(totalsRaw){
  const t = safeJSON(totalsRaw) ?? totalsRaw ?? {};
  if (t && t.totalCharge != null) return num(t.totalCharge, 0);
  const sumParts = ["matCharge","eqCharge","inkCharge","laborCharge","addonCharge"]
    .map(k=>num(t?.[k],0))
    .reduce((a,b)=>a+b,0);
  if (sumParts > 0) return sumParts;
  if (t.subtotal != null) return num(t.subtotal, 0);
  if (t.subTotal != null) return num(t.subTotal, 0);
  return 0;
}

// recompute revenue per invoice using current discount/tax flags + tenant tax rate
function computeInvoiceGrand(row, taxRatePct){
  const preTax = extractPreTax(row?.totals);
  const dt = (row?.discount_type || "").toLowerCase(); // 'percent' | 'amount' | ''
  const dv = num(row?.discount_value, 0);
  const discount = dt === "percent" ? preTax * (dv/100) : (dt === "amount" ? dv : 0);
  // assume tax applies; remove or wire to a column when added
  const taxBase  = (row?.discount_apply_tax ? (preTax - discount) : preTax);
  const tax      = taxBase * (num(taxRatePct,0)/100);
  const grand    = (preTax - discount) + tax;
  return Math.max(0, grand);
}

export default function Dashboard(){
  const {tenantId}=useTenant();
  const [equip,setEquip]=useState([]);
  const [recent,setRecent]=useState({quotes:[],jobs:[],invoices:[]});
  const [stats,setStats]=useState({quotes:0,jobs:0,revenue:0});
  const [loading,setLoading]=useState(true);

  const load=async ()=>{
    if(!tenantId) return;
    setLoading(true);

    const [
      eqRes,
      qRecentRes,
      jRecentRes,
      iRecentRes,
      qCountRes,
      jCountRes,
      settingsRes,
    ] = await Promise.all([
      supabase.from("equipments").select("*").eq("tenant_id",tenantId).order("name",{ascending:true}),
      supabase.from("quotes").select("id,code,title,created_at,totals").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("jobs").select("id,code,title,created_at,totals,status").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("invoices").select("id,code,created_at,totals").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("quotes").select("id",{count:"exact", head:true}).eq("tenant_id",tenantId),
      supabase.from("jobs").select("id",{count:"exact", head:true}).eq("tenant_id",tenantId),
      supabase.from("settings").select("tax_rate").eq("tenant_id",tenantId).single(),
    ]);

    const eq = (eqRes.data||[]).filter(r=>UVLIKE.has(String(r.type||"").toLowerCase())).map(normalizeEquip);
    setEquip(eq);

    setRecent({
      quotes: qRecentRes.data||[],
      jobs: jRecentRes.data||[],
      invoices: iRecentRes.data||[]
    });

    const taxRate = settingsRes.data?.tax_rate ?? 0;

    // fetch all invoices with only columns we KNOW exist
    let invAll = [];
    const iAllRes = await supabase
      .from("invoices")
      .select("totals, discount_type, discount_value, discount_apply_tax")
      .eq("tenant_id",tenantId);

    if(iAllRes.error){
      console.warn("Revenue query fell back due to select error:", iAllRes.error?.message);
      // fallback: at least get totals, compute pre-tax (no discount/tax adjustment possible)
      const fb = await supabase.from("invoices").select("totals").eq("tenant_id",tenantId);
      invAll = fb.data || [];
    }else{
      invAll = iAllRes.data || [];
    }

    const revenue = invAll.reduce((sum,row)=> sum + computeInvoiceGrand(row, taxRate), 0);

    setStats({
      quotes: qCountRes.count||0,
      jobs: jCountRes.count||0,
      revenue
    });

    setLoading(false);
  };

  useEffect(()=>{
    load();
    if(!tenantId) return;
    const ch=supabase.channel(`dash-${tenantId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"invoices",filter:`tenant_id=eq.${tenantId}`},load)
      .on("postgres_changes",{event:"*",schema:"public",table:"settings", filter:`tenant_id=eq.${tenantId}`},load)
      .on("postgres_changes",{event:"*",schema:"public",table:"equipments",filter:`tenant_id=eq.${tenantId}`},load)
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tenantId]);

  const cards=useMemo(()=>[
    {icon:"fa-file-pen",   bg:"bg-blue",  label:"Quotes",  value: stats.quotes},
    {icon:"fa-briefcase",  bg:"bg-cyan",  label:"Jobs",    value: stats.jobs},
    {icon:"fa-sack-dollar",bg:"bg-green", label:"Revenue", value: `$${Number(stats.revenue||0).toFixed(2)}`}
  ],[stats]);

  return (
    <section className="section">
      <h2>Dashboard</h2>

      <div className="status-cards">
        {cards.map((c,i)=>(
          <div key={i} className="status-card">
            <div className={`icon-box ${c.bg}`}><i className={`fa-solid ${c.icon}`}/></div>
            <div className="status-text">
              <span className="label">{c.label}</span>
              <span className="value">{c.value}</span>
            </div>
          </div>
        ))}
      </div>

      <InkLevels equip={equip} tenantId={tenantId} />

      <div className="recent-activity" style={{marginTop:20}}>
        <h3>Recent Activity</h3>
        <div className="cards">
          {(recent.quotes||[]).map((r)=>(
            <div key={`q-${r.id}`} className="recent-activity-item">
              <p><strong>Quote</strong> <span className="mono">#{r.code}</span> — {r.title||"Untitled"}</p>
              <p className="tiny">{new Date(r.created_at).toLocaleString()}</p>
            </div>
          ))}
          {(recent.jobs||[]).map((r)=>(
            <div key={`j-${r.id}`} className="recent-activity-item">
              <p><strong>Job</strong> <span className="mono">#{r.code}</span> — {r.title||"Untitled"} <span className="badge">{r.status||"active"}</span></p>
              <p className="tiny">{new Date(r.created_at).toLocaleString()}</p>
            </div>
          ))}
          {(recent.invoices||[]).map((r)=>(
            <div key={`i-${r.id}`} className="recent-activity-item">
              <p><strong>Invoice</strong> <span className="mono">#{r.code}</span></p>
              <p className="tiny">{new Date(r.created_at).toLocaleString()}</p>
            </div>
          ))}
          {(!recent.quotes?.length && !recent.jobs?.length && !recent.invoices?.length) ? (
            <div className="tiny">Nothing yet.</div>
          ):null}
        </div>
      </div>
    </section>
  );
}

// ----- Ink levels block (preserves your look/behavior) -----
function InkLevels({equip, tenantId}){
  const [list,setList]=useState(equip);
  useEffect(()=>{ setList(equip); },[equip]);

  const updateLocal=(id, mut)=>{
    setList((xs)=>xs.map((e)=>e.id===id? mut(structuredClone(e)) : e));
  };

  const toggleWhiteSoft=async (row)=>{
    const next=!row.use_soft_white;
    updateLocal(row.id,(e)=>{ e.use_soft_white=next; return e; });
    const {error}=await supabase.from("equipments").update({use_soft_white: next})
      .eq("tenant_id",tenantId).eq("id",row.id);
    if(error){ updateLocal(row.id,(e)=>{ e.use_soft_white=!next; return e; }); }
  };

  const refill=async (row,key)=>{
    updateLocal(row.id,(e)=>{ e.levels[key]=100; return e; });
    try{
      const {data}=await supabase.from("equipments").select("ink_levels").eq("tenant_id",tenantId).eq("id",row.id).single();
      let lv=safeJSON(data?.ink_levels) || {};
      lv={...lv,[key]:100};
      const up=await supabase.from("equipments").update({ink_levels: lv}).eq("tenant_id",tenantId).eq("id",row.id);
      if(up.error){
        const map={c:"ink_level_c",m:"ink_level_m",y:"ink_level_y",k:"ink_level_k",white:"ink_level_white",soft_white:"ink_level_soft_white",gloss:"ink_level_gloss"};
        const col=map[key];
        if(col){ await supabase.from("equipments").update({[col]:100}).eq("tenant_id",tenantId).eq("id",row.id); }
      }
    }catch{}
  };

  return (
    <div className="card">
      <h3 style={{marginTop:0}}>Ink Levels</h3>
      <div className="ink-levels">
        {list.map((e)=>(
          <div key={e.id} className="ink-levels-row">
            <div className="ink-name" style={{gridColumn:"1 / -1", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
              <div>{e.name} <span className="tiny" style={{color:"#666"}}>({e.type})</span></div>
              {e.kind==="uv" && Number(e.rate_soft_white||0)>0 ? (
                <button className="btn btn-outline-primary tiny" onClick={()=>toggleWhiteSoft(e)}>
                  {e.use_soft_white? "Switch to White":"Switch to Soft-White"}
                </button>
              ):null}
            </div>

            {bar({lbl:"C", pct:e.levels.c, col:"#00b7eb", thr:e.thr, onRefill:()=>refill(e,"c")})}
            {bar({lbl:"M", pct:e.levels.m, col:"#ff00a6", thr:e.thr, onRefill:()=>refill(e,"m")})}
            {bar({lbl:"Y", pct:e.levels.y, col:"#ffd400", thr:e.thr, onRefill:()=>refill(e,"y")})}
            {bar({lbl:"K", pct:e.levels.k, col:"#000",    thr:e.thr, onRefill:()=>refill(e,"k")})}

            {e.kind==="uv"  && !e.use_soft_white ? bar({lbl:"W",  pct:e.levels.white,      col:"#fff", thr:e.thr, border:"#ddd", onRefill:()=>refill(e,"white")}):null}
            {e.kind==="uv"  &&  e.use_soft_white ? bar({lbl:"SW", pct:e.levels.soft_white, col:"#eee", thr:e.thr, border:"#ddd", onRefill:()=>refill(e,"soft_white")}):null}
            {e.kind==="uv"  && e.levels.gloss!=null ? bar({lbl:"G", pct:e.levels.gloss, col:"#bbb", thr:e.thr, border:"#bbb", onRefill:()=>refill(e,"gloss")}):null}
            {e.kind==="sub" && e.levels.white!=null ? bar({lbl:"W", pct:e.levels.white, col:"#fff", thr:e.thr, border:"#ddd", onRefill:()=>refill(e,"white")}):null}
          </div>
        ))}
        {list.length===0? <div className="tiny">No UV/Sublimation equipment found.</div>:null}
      </div>
    </div>
  );
}

function bar({lbl,pct,col,thr,border,onRefill}){
  const low=(pct??0)<=thr;
  const tLine=100-thr;
  return (
    <div className={`ink-bar${low? " low-ink":""}`}>
      <div className="ink-name">{lbl}</div>
      <div className="progress" style={{border:border?`1px solid ${border}`:undefined}}>
        <div className="threshold-line" style={{top:`${tLine}%`}}/>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:`${pct??0}%`,background:col}} />
        <div style={{position:"absolute",top:-18,left:"50%",transform:"translateX(-50%)",fontSize:12,color:"#333"}}>{Math.max(0,Math.round(pct??0))}%</div>
      </div>
      <button className="btn refill-btn" disabled={!low} onClick={onRefill} style={low?{background:"#dc3545",color:"#fff"}:undefined}>Refill</button>
    </div>
  );
}

function normalizeEquip(r){
  const isUV = String(r.type||"").toLowerCase()==="uv printer";
  const kind = isUV? "uv" : "sub";
  const thr = num(r.threshold_pct, 20);
  const use_soft_white = !!r.use_soft_white;

  const jsonLevels = safeJSON(r.ink_levels);
  const lv = jsonLevels && typeof jsonLevels==="object" ? jsonLevels : {
    c:r.ink_level_c, m:r.ink_level_m, y:r.ink_level_y, k:r.ink_level_k,
    white:r.ink_level_white, soft_white:r.ink_level_soft_white, gloss:r.ink_level_gloss
  };

  const pct = (v)=> Math.max(0, Math.min(100, num(v, 100)));
  const levels={
    c: pct(lv.c), m: pct(lv.m), y: pct(lv.y), k: pct(lv.k),
    white: pct(lv.white), soft_white: pct(lv.soft_white),
    gloss: isUV ? pct(lv.gloss) : null
  };

  return {
    id:r.id, name:r.name||"(Unnamed)", type:r.type||"",
    kind, thr, use_soft_white,
    levels,
    rate_soft_white: num(r.rate_soft_white, 0)
  };
}
