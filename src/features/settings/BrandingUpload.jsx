import {useState} from 'react';
import {supabase} from '../../lib/superbase.js';
import {useTenant} from '../../context/TenantContext.jsx';

export default function BrandingUpload({logoPath, onChange, label='Logo (PNG/SVG/JPG)'}){
  const {tenantId}=useTenant();
  const [busy,setBusy]=useState(false);

  const pick=async (e)=>{
    const file=e.target.files?.[0]; if(!file||!tenantId) return;
    setBusy(true);
    const path=`${tenantId}/logo-${Date.now()}-${file.name}`;
    const {error}=await supabase.storage.from('branding').upload(path, file, {upsert:true, cacheControl:'3600'});
    setBusy(false);
    if(error){ alert(error.message); return; }
    onChange?.(path);
  };

  const remove=async ()=>{
    if(!logoPath) return;
    if(!confirm('Remove current logo?')) return;
    await supabase.storage.from('branding').remove([logoPath]).catch(()=>{});
    onChange?.('');
  };

  return (
    <div className="group">
      <label>{label}</label>
      <input type="file" accept="image/*,.svg" onChange={pick} disabled={busy}/>
      {logoPath?(
        <div className="tiny row" style={{alignItems:'center',gap:8,marginTop:6}}>
          <span className="mono">{logoPath}</span>
          <button type="button" className="btn btn-secondary" onClick={remove} disabled={busy}>Remove</button>
        </div>
      ):<div className="tiny">Upload a square logo for best results.</div>}
    </div>
  );
}
