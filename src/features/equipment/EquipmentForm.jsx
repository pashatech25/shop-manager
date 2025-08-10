import React,{useEffect,useMemo,useState} from "react";
import {toast} from "react-toastify";
import {supabase} from "../../lib/superbase.js";

const TYPES=["UV Printer","Sublimation Printer","3D Printer","Co2 Laser","Fiber Laser","Diode Laser","Mopa Laser","UV Laser","Vinyl Cutter","CNC","Others"];
const isUV=(t)=>String(t||"").toLowerCase()==="uv printer";
const isSUB=(t)=>String(t||"").toLowerCase()==="sublimation printer";
const isLaser=(t)=>String(t||"").toLowerCase().includes("laser");
const ML_MAX=100;

export default function EquipmentForm({tenantId,initial,onClose,onSaved}){
  const editing=!!initial;

  // ---------------- Basics ----------------
  const [name,setName]=useState(initial?.name||"");
  const [type,setType]=useState(initial?.type||"");
  const [description,setDescription]=useState(initial?.description||"");
  const [thresholdPct,setThresholdPct]=useState(initial?.threshold_pct??20);

  // White variant (mutually exclusive for UV): false = White, true = Soft-White
  const [useSoftWhite,setUseSoftWhite]=useState(!!initial?.use_soft_white);

  // Some Sublimations have White (no Soft-White there)
  const [subHasWhite,setSubHasWhite]=useState(()=>{
    if(!isSUB(initial?.type)) return false;
    // infer from existing data
    const hasRate = Number(initial?.rate_white||0)>0;
    let lv = initial?.ink_levels;
    if(typeof lv==="string"){ try{ lv=JSON.parse(lv); }catch{ lv=null; } }
    const hasLevel = lv && lv.white!=null ? true : (initial?.ink_level_white!=null);
    return hasRate || hasLevel;
  });

  // ---------------- Rates per mL ----------------
  const [rate,setRate]=useState({
    c: initial?.rate_c??0, m: initial?.rate_m??0, y: initial?.rate_y??0, k: initial?.rate_k??0,
    white: initial?.rate_white??0, soft_white: initial?.rate_soft_white??0, gloss: initial?.rate_gloss??0
  });

  // ---------------- Level overrides (mL, 0–100) ----------------
  const initLevels=useMemo(()=>{
    let lv=initial?.ink_levels; if(typeof lv==="string"){ try{ lv=JSON.parse(lv); }catch{ lv=null; } }
    if(lv && typeof lv==="object"){
      return {c:lv.c??null, m:lv.m??null, y:lv.y??null, k:lv.k??null, white:lv.white??null, soft_white:lv.soft_white??null, gloss:lv.gloss??null};
    }
    return {
      c: initial?.ink_level_c ?? null,
      m: initial?.ink_level_m ?? null,
      y: initial?.ink_level_y ?? null,
      k: initial?.ink_level_k ?? null,
      white: initial?.ink_level_white ?? null,
      soft_white: initial?.ink_level_soft_white ?? null,
      gloss: initial?.ink_level_gloss ?? null
    };
  },[initial]);

  const [lvl,setLvl]=useState(initLevels);

  // Defaults for brand-new printers
  useEffect(()=>{
    if(editing) return;
    if(isUV(type)||isSUB(type)){
      setLvl((s)=>({
        c: s.c??100, m: s.m??100, y: s.y??100, k: s.k??100,
        white: s.white??100,
        soft_white: s.soft_white??100, // kept even if not active, for future toggle
        gloss: isUV(type) ? (s.gloss??100) : null
      }));
    }
  },[editing,type]);

  // Visibility helpers
  const showCMYK = isUV(type)||isSUB(type);
  const showGloss = isUV(type);
  const showWhiteActiveUV = isUV(type) && !useSoftWhite; // UV: only active white variant shows in fields
  const showSoftActiveUV  = isUV(type) &&  useSoftWhite;
  const showWhiteSUB      = isSUB(type) && subHasWhite;

  // --- handlers
  const setRateField=(k,v)=> setRate((s)=>({...s,[k]: v===""? "": v}));
  const setLvlField =(k,v)=> setLvl ((s)=>({...s,[k]: v===""? "": v}));

  const onSubmit=async ()=>{
    try{
      if(!tenantId) throw new Error("No tenant context");
      if(!name.trim()) throw new Error("Name is required");
      if(!type) throw new Error("Type is required");

      const to3=(v)=> v===""||v==null ? null : Math.max(0, Math.min(ML_MAX, Math.round(Number(v)*1000)/1000));

      // prune channels based on selections
      const effective = {
        c: showCMYK? to3(lvl.c) : null,
        m: showCMYK? to3(lvl.m) : null,
        y: showCMYK? to3(lvl.y) : null,
        k: showCMYK? to3(lvl.k) : null,
        white: (isUV(type) ? to3(lvl.white) : (showWhiteSUB? to3(lvl.white) : null)),
        soft_white: isUV(type) ? to3(lvl.soft_white) : null,
        gloss: showGloss ? to3(lvl.gloss) : null
      };

      const payload={
        tenant_id: tenantId,
        name, description, type,
        threshold_pct: Number(thresholdPct??0),
        use_soft_white: isUV(type)? !!useSoftWhite : false, // only matters for UV
        // rates
        rate_c: showCMYK? Number(rate.c||0):0,
        rate_m: showCMYK? Number(rate.m||0):0,
        rate_y: showCMYK? Number(rate.y||0):0,
        rate_k: showCMYK? Number(rate.k||0):0,
        rate_white: (isUV(type) || showWhiteSUB)? Number(rate.white||0):0,
        rate_soft_white: isUV(type)? Number(rate.soft_white||0):0,
        rate_gloss: showGloss? Number(rate.gloss||0):0,
        // levels json + legacy mirror
        ink_levels: effective,
        ink_level_c: effective.c, ink_level_m: effective.m, ink_level_y: effective.y, ink_level_k: effective.k,
        ink_level_white: effective.white, ink_level_soft_white: effective.soft_white, ink_level_gloss: effective.gloss
      };

      let res;
      if(editing){
        res=await supabase.from("equipments").update(payload).eq("id", initial.id).eq("tenant_id", tenantId).select("id").single();
      }else{
        res=await supabase.from("equipments").insert(payload).select("id").single();
      }
      if(res.error) throw res.error;

      toast.success(editing? "Equipment updated":"Equipment created");
      onSaved?.();
      onClose?.();
    }catch(err){
      console.error(err);
      toast.error(err.message||"Save failed");
    }
  };

  return (
    <div id="job-modal" style={{display:"flex"}}>
      <div className="modal-content wide">
        {/* Header */}
        <div className="row">
          <h3 style={{margin:0}}>{editing? "Edit Equipment":"New Equipment"}</h3>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={onSubmit}>{editing? "Save Changes":"Create"}</button>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>

        {/* Basics */}
        <div className="card" style={{marginTop:12}}>
          <div className="grid-2">
            <div className="group">
              <label>Equipment Name</label>
              <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g., Mimaki UJF-6042"/>
            </div>
            <div className="group">
              <label>Type</label>
              <select value={type} onChange={(e)=>setType(e.target.value)}>
                <option value="">Select type…</option>
                {TYPES.map((t)=>(<option key={t} value={t}>{t}</option>))}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="group">
              <label>Description</label>
              <input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Optional notes…"/>
            </div>
            <div className="group">
              <label>Ink low threshold %</label>
              <input type="number" min="0" max="100" value={thresholdPct} onChange={(e)=>setThresholdPct(e.target.value)}/>
            </div>
          </div>
        </div>

        {/* Ink Setup */}
        {(isUV(type)||isSUB(type))? (
          <div className="card" style={{marginTop:12}}>
            <h4 style={{margin:"0 0 10px"}}>Ink Setup</h4>

            {/* Variant controls */}
            <div className="grid-2">
              {isUV(type)? (
                <div className="group">
                  <label>White Variant (UV)</label>
                  <div className="chips">
                    <button type="button" className={`chip ${!useSoftWhite? "active":""}`} onClick={()=>setUseSoftWhite(false)}>White</button>
                    <button type="button" className={`chip ${useSoftWhite? "active":""}`} onClick={()=>setUseSoftWhite(true)}>Soft-White</button>
                  </div>
                  <div className="tiny">Dashboard shows only the active variant; toggle there when both are priced.</div>
                </div>
              ):(
                <div className="group">
                  <label>White Channel (Sublimation)</label>
                  <div className="chips">
                    <button
                      type="button"
                      className={`chip ${subHasWhite? "active":""}`}
                      onClick={()=>setSubHasWhite(v=>!v)}
                    >
                      {subHasWhite? "Enabled":"Disabled"}
                    </button>
                  </div>
                  <div className="tiny">Some sublimation printers support White. Enable to track & price it.</div>
                </div>
              )}

              {isUV(type)? (
                <div className="group">
                  <label>Gloss Channel (UV)</label>
                  <div className="chips">
                    <button
                      type="button"
                      className={`chip ${lvl.gloss!=null? "active":""}`}
                      onClick={()=> setLvlField("gloss", lvl.gloss==null? (lvl.gloss??100) : null)}
                    >{lvl.gloss==null? "Gloss Off":"Gloss On"}</button>
                  </div>
                </div>
              ): <div/>}
            </div>

            {/* Rates */}
            <h5 style={{margin:"14px 0 6px"}}>Ink Rates (per mL)</h5>
            <div className="grid-3">
              {/* CMYK always for UV/SUB */}
              <RateField label="Cyan rate" color="#00b7eb" value={rate.c} onChange={(v)=>setRateField("c",v)}/>
              <RateField label="Magenta rate" color="#ff00a6" value={rate.m} onChange={(v)=>setRateField("m",v)}/>
              <RateField label="Yellow rate" color="#ffd400" value={rate.y} onChange={(v)=>setRateField("y",v)}/>
              <RateField label="Black rate" color="#222" value={rate.k} onChange={(v)=>setRateField("k",v)}/>

              {/* UV whites (exclusive fields) */}
              {isUV(type) && !useSoftWhite ? <RateField label="White rate" color="#fff" border="#ddd" value={rate.white} onChange={(v)=>setRateField("white",v)}/> : null}
              {isUV(type) &&  useSoftWhite ? <RateField label="Soft-White rate" color="#eee" value={rate.soft_white} onChange={(v)=>setRateField("soft_white",v)}/> : null}

              {/* Sublimation optional White */}
              {showWhiteSUB ? <RateField label="White rate (SUB)" color="#fff" border="#ddd" value={rate.white} onChange={(v)=>setRateField("white",v)}/> : null}

              {/* UV Gloss */}
              {showGloss ? <RateField label="Gloss rate" color="#bbb" value={rate.gloss} onChange={(v)=>setRateField("gloss",v)}/> : null}
            </div>

            {/* Levels */}
            <h5 style={{margin:"14px 0 6px"}}>Ink Levels (override, mL)</h5>
            <p className="tiny">All channels use 100 mL full scale. Enter up to 3 decimals.</p>
            <div className="grid-3">
              <LevelField label="Cyan (mL)" color="#00b7eb" value={lvl.c} onChange={(v)=>setLvlField("c",v)}/>
              <LevelField label="Magenta (mL)" color="#ff00a6" value={lvl.m} onChange={(v)=>setLvlField("m",v)}/>
              <LevelField label="Yellow (mL)" color="#ffd400" value={lvl.y} onChange={(v)=>setLvlField("y",v)}/>
              <LevelField label="Black (mL)" color="#222" value={lvl.k} onChange={(v)=>setLvlField("k",v)}/>

              {/* UV whites (exclusive field shows) */}
              {isUV(type) && !useSoftWhite ? <LevelField label="White (mL)" color="#fff" border="#ddd" value={lvl.white} onChange={(v)=>setLvlField("white",v)}/> : null}
              {isUV(type) &&  useSoftWhite ? <LevelField label="Soft-White (mL)" color="#eee" value={lvl.soft_white} onChange={(v)=>setLvlField("soft_white",v)}/> : null}

              {/* Sublimation optional White */}
              {showWhiteSUB ? <LevelField label="White (mL)" color="#fff" border="#ddd" value={lvl.white} onChange={(v)=>setLvlField("white",v)}/> : null}

              {/* UV Gloss */}
              {showGloss ? <LevelField label="Gloss (mL)" color="#bbb" value={lvl.gloss} onChange={(v)=>setLvlField("gloss",v)}/> : null}
            </div>
          </div>
        ):null}

        {/* Laser extras (kept minimal / layout-consistent) */}
        {isLaser(type)? (
          <div className="card" style={{marginTop:12}}>
            <h4 style={{marginTop:0}}>Laser Details</h4>
            <div className="grid-2">
              <div className="group">
                <label>Laser Power (W)</label>
                <input type="number" min="0" step="1" defaultValue={initial?.laser_power??""} />
              </div>
              <div className="group">
                <label>Laser Brand</label>
                <input defaultValue={initial?.laser_brand??""} />
              </div>
            </div>
            <div className="tiny">These are display-only here for now.</div>
          </div>
        ):null}
      </div>
    </div>
  );
}

function RateField({label,color,border,value,onChange}){
  return (
    <div className="group">
      <label className="m-0"><span className="ink-color-box" style={{background:color,border:border?`1px solid ${border}`:undefined}}/> {label}</label>
      <input type="number" min="0" step="0.0001" value={value===""?"":value} onChange={(e)=>onChange(e.target.value)}/>
    </div>
  );
}
function LevelField({label,color,border,value,onChange}){
  return (
    <div className="group">
      <label className="m-0"><span className="ink-color-box" style={{background:color,border:border?`1px solid ${border}`:undefined}}/> {label}</label>
      <input type="number" min="0" max={ML_MAX} step="0.001" value={value===""?"":value} onChange={(e)=>onChange(e.target.value)} placeholder="0–100"/>
    </div>
  );
}
