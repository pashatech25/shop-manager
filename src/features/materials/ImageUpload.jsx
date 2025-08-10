import {useState} from 'react';
import {supabase} from '../../lib/superbase.js';
import {useTenant} from '../../context/TenantContext.jsx';

export default function ImageUpload({value, onChange, label='Picture'}){
  const {tenantId}=useTenant();
  const [busy,setBusy]=useState(false);

  const pick=async (e)=>{
    const file=e.target.files?.[0];
    if(!file || !tenantId) return;
    setBusy(true);
    const path=`${tenantId}/${crypto.randomUUID()}-${file.name}`;
    const {error}=await supabase.storage.from('material-images').upload(path, file, {upsert:true, cacheControl:'3600'});
    setBusy(false);
    if(error){ alert(error.message); return; }
    onChange?.(path);
  };

  const remove=async ()=>{
    if(!value) return;
    if(!confirm('Remove image?')) return;
    await supabase.storage.from('material-images').remove([value]).catch(()=>{});
    onChange?.(null);
  };

  return (
    <div className="group">
      <label>{label}</label>
      <input type="file" accept="image/*" onChange={pick} disabled={busy}/>
      {value?(
        <div className="tiny" style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="mono">{value}</span>
          <button type="button" className="btn btn-secondary" onClick={remove} disabled={busy}>Remove</button>
        </div>
      ): <div className="tiny">PNG/JPG</div>}
    </div>
  );
}
