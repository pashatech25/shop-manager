import {supabase} from '../../lib/superbase.js';

export const listTypes=async (tenantId, kind)=>{
  const {data,error}=await supabase.from('custom_types').select('*').eq('tenant_id', tenantId).eq('kind', kind).order('name');
  if(error) throw error;
  return data||[];
};

export const addType=async (tenantId, kind, name)=>{
  const {data,error}=await supabase.from('custom_types').insert({tenant_id:tenantId, kind, name}).select().single();
  if(error) throw error;
  return data;
};

export const deleteType=async (tenantId, id)=>{
  const {error}=await supabase.from('custom_types').delete().eq('id', id).eq('tenant_id', tenantId);
  if(error) throw error;
};
