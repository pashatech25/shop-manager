import {useEffect,useMemo,useState} from "react";
import {supabase} from "../lib/superbase.js";
import {useTenant} from "../context/TenantContext.jsx";

const UVLIKE=new Set(["uv printer","sublimation printer"]);

export default function Dashboard(){
  const {tenantId}=useTenant();

  const [equip,setEquip]=useState([]);
  const [recent,setRecent]=useState({quotes:[],jobs:[],invoices:[]});
  const [stats,setStats]=useState({quotes:0,jobs:0,revenue:0});
  const [loading,setLoading]=useState(true);

  const updateEquipLocal=(id, updater)=>{
    setEquip((list)=>list.map((e)=> e.id===id? updater(structuredClone(e)) : e));
  };

  const load=async ()=>{
    if(!tenantId) return;
    setLoading(true);

    const [eqRes,qRes,jRes,iRes,qs,js] = await Promise.all([
      supabase.from("equipments").select("*").eq("tenant_id",tenantId).order("name",{ascending:true}),
      supabase.from("quotes").select("id,code,title,created_at,totals").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("jobs").select("id,code,title,created_at,totals,status").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("invoices").select("id,code,created_at,totals").eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(5),
      supabase.from("quotes").select("id",{count:"exact", head:true}).eq("tenant_id",tenantId),
      supabase.from("jobs").select("id",{count:"exact", head:true}).eq("tenant_id",tenantId)
    ]);

    const eq=(eqRes.data||[]).filter((r)=>UVLIKE.has(String(r.type||"").toLowerCase())).map(normalizePreserve);
    setEquip(eq);

    setRecent({
      quotes: qRes.data||[],
      jobs: jRes.data||[],
      invoices: iRes.data||[]
    });

    const revenue = (iRes.data||[]).reduce((s,row)=> s + Number(row?.totals?.grand||0), 0);
    setStats({quotes: qs.count||0, jobs: js.count||0, revenue});
    setLoading(false);
  };

  useEffect(()=>{
    load();
    if(!tenantId) return;
    const ch1=supabase.channel(`equip-${tenantId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"equipments",filter:`tenant_id=eq.${tenantId}`},load)
      .subscribe();
    const ch2=supabase.channel(`sales-${tenantId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"quotes",filter:`tenant_id=eq.${tenantId}`},load)
      .on("postgres_changes",{event:"*",schema:"public",table:"jobs",filter:`tenant_id=eq.${tenantId}`},load)
      .on("postgres_changes",{event:"*",schema:"public",table:"invoices",filter:`tenant_id=eq.${tenantId}`},load)
      .subscribe();
    return ()=>{ supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tenantId]);

  const toggleWhiteSoft=async (row)=>{
    const nextUseSW = !row.use_soft_white;

    // optimistic flip of the flag only
    updateEquipLocal(row.id,(e)=>{ e.use_soft_white = nextUseSW; return e; });

    const {error}=await supabase.from("equipments")
      .update({use_soft_white: nextUseSW})
      .eq("tenant_id",tenantId).eq("id",row.id);

    if(error){
      updateEquipLocal(row.id,(e)=>{ e.use_soft_white = !nextUseSW; return e; });
      console.error(error);
    }
  };

  const onRefill=async (key,row)=>{
    // optimistic per-color refill
    updateEquipLocal(row.id,(e)=>{ e.levels[key]=100; return e; });

    try{
      const {data:rowDb}=await supabase.from("equipments")
        .select("ink_levels")
        .eq("tenant_id",tenantId).eq("id",row.id).single();

      let lv=rowDb?.ink_levels;
      if(typeof lv==="string"){ try{ lv=JSON.parse(lv); }catch{ lv=null; } }
      if(!lv||typeof lv!=="object") lv={};
      lv={...lv,[key]:100};

      const upd=await supabase.from("equipments").update({ink_levels: lv}).eq("tenant_id",tenantId).eq("id",row.id);
      if(upd.error){
        const colMap={c:"ink_level_c",m:"ink_level_m",y:"ink_level_y",k:"ink_level_k",white:"ink_level_white",soft_white:"ink_level_soft_white",gloss:"ink_level_gloss"};
        const col=colMap[key];
        if(col){ await supabase.from("equipments").update({[col]:100}).eq("tenant_id",tenantId).eq("id",row.id); }
      }
    }catch(err){ console.error(err); }
  };

  const cards=useMemo(()=>[
    {icon:"fa-file-pen",   bg:"bg-blue", label:"Quotes", value: stats.quotes},
    {icon:"fa-briefcase",  bg:"bg-cyan", label:"Jobs",   value: stats.jobs},
    {icon:"fa-sack-dollar",bg:"bg-green",label:"Revenue",value: `$${Number(stats.revenue||0).toFixed(2)}`}
  ],[stats]);

  return (
    <section className="section">
      <h2>Dashboard</h2>

      {/* shadow boxes */}
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

      {/* Ink levels */}
      <div className="card">
        <h3 style={{marginTop:0}}>Ink Levels</h3>
        {loading? <div className="tiny">Loading…</div> : null}
        {!loading && equip.length===0? <div className="tiny">No UV/Sublimation equipment found.</div> : null}

        <div className="ink-levels">
          {equip.map((e)=>(
            <div key={e.id} className="ink-levels-row">
              <div className="ink-name" style={{gridColumn:"1 / -1", display:"flex", alignItems:"center", justifyContent:"space-between"}}>
                <div>{e.name} <span className="tiny" style={{color:"#666"}}>({e.type})</span></div>

                {/* Toggle visible only when soft-white is priced (>0) */}
                {e.kind==="uv" && Number(e.rate_soft_white||0)>0 ? (
                  <button
                    className="btn btn-outline-primary tiny"
                    onClick={()=>toggleWhiteSoft(e)}
                    title={e.use_soft_white? "Switch to White":"Switch to Soft-White"}
                  >
                    {e.use_soft_white? "Switch to White":"Switch to Soft-White"}
                  </button>
                ):null}
              </div>

              {bar({lbl:"C", pct:e.levels.c, col:"#00b7eb", thr:e.thr, onRefill:()=>onRefill("c",e)})}
              {bar({lbl:"M", pct:e.levels.m, col:"#ff00a6", thr:e.thr, onRefill:()=>onRefill("m",e)})}
              {bar({lbl:"Y", pct:e.levels.y, col:"#ffd400", thr:e.thr, onRefill:()=>onRefill("y",e)})}
              {bar({lbl:"K", pct:e.levels.k, col:"#000",    thr:e.thr, onRefill:()=>onRefill("k",e)})}

              {/* For UV: only active variant rendered; both levels preserved */}
              {e.kind==="uv" && !e.use_soft_white ? bar({lbl:"W",  pct:e.levels.white,      col:"#fff", thr:e.thr, border:"#ddd", onRefill:()=>onRefill("white",e)}):null}
              {e.kind==="uv" &&  e.use_soft_white ? bar({lbl:"SW", pct:e.levels.soft_white, col:"#eee", thr:e.thr, border:"#ddd", onRefill:()=>onRefill("soft_white",e)}):null}

              {/* Sublimation optional White */}
              {e.kind==="sub" && e.levels.white!=null ? bar({lbl:"W", pct:e.levels.white, col:"#fff", thr:e.thr, border:"#ddd", onRefill:()=>onRefill("white",e)}):null}

              {/* Gloss only for UV if present */}
              {e.kind==="uv" && e.levels.gloss!=null? bar({lbl:"G", pct:e.levels.gloss, col:"#bbb", thr:e.thr, border:"#bbb", onRefill:()=>onRefill("gloss",e)}):null}
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
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

/** Preserve both white & soft-white values; only the render layer decides which to show */
function normalizePreserve(r){
  const t=String(r.type||"").toLowerCase();
  const kind= t==="uv printer" ? "uv" : "sub";
  const thr=toPct(r.threshold_pct??20);
  const use_soft_white=!!r.use_soft_white;

  let lv=r.ink_levels;
  if(typeof lv==="string"){ try{ lv=JSON.parse(lv); }catch{ lv=null; } }
  if(!lv||typeof lv!=="object"){
    lv={
      c:r.ink_level_c, m:r.ink_level_m, y:r.ink_level_y, k:r.ink_level_k,
      white:r.ink_level_white, soft_white:r.ink_level_soft_white, gloss:r.ink_level_gloss
    };
  }

  const def=(v)=> v==null? 100 : Number(v);
  const levels={
    c:toPct(def(lv.c)),
    m:toPct(def(lv.m)),
    y:toPct(def(lv.y)),
    k:toPct(def(lv.k)),
    white: toPct(def(lv.white)),
    soft_white: toPct(def(lv.soft_white)),
    gloss: kind==="uv" ? toPct(def(lv.gloss)) : null
  };

  const rate_soft_white = Number(r.rate_soft_white||0);
  return {id:r.id,name:r.name||"(Unnamed)",type:r.type||"",kind,thr,use_soft_white,levels,rate_soft_white};
}

function toPct(v){ const n=Number(v); if(!Number.isFinite(n)) return 0; return Math.max(0,Math.min(100,n)); }
