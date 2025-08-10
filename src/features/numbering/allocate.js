import {supabase} from '../../lib/superbase.js';

// Best: use a Postgres function `allocate_code(kind text, tenant uuid)`.
// We try RPC first; if missing, we fall back to a cautious client update.
export async function allocateCode(tenantId, kind){
  // kind in {'quote','job','invoice'}
  try{
    const {data,error}=await supabase.rpc('allocate_code',{p_kind:kind, p_tenant_id:tenantId});
    if(error) throw error;
    if(data?.code) return data.code;
  }catch(_){ /* fall back below */ }

  // Fallback: read settings, compute next code, attempt update.
  const {data:st,error:se}=await supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle();
  if(se||!st) throw se||new Error('Settings not found');

  const prefix=st[`${kind}_prefix`]||((kind==='invoice')?'INV-':kind==='job'?'J-':'Q-');
  const counter=Number(st[`${kind}_counter`]||1);
  const code=`${prefix}${String(counter).padStart(5,'0')}`;

  const patch={};
  patch[`${kind}_counter`]=counter+1;
  const {error:ue}=await supabase.from('settings').update(patch).eq('tenant_id', tenantId);
  if(ue) throw ue;
  return code;
}
