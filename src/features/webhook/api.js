import {supabase} from '../../lib/superbase.js';

export const listDeliveries=async (tenantId, limit=50)=>{
  const {data,error}=await supabase.from('webhook_deliveries')
    .select('*').eq('tenant_id', tenantId)
    .order('created_at',{ascending:false}).limit(limit);
  if(error) throw error;
  return data||[];
};

export const retryDelivery=async (id)=>{
  const {error}=await supabase.from('webhook_deliveries')
    .update({status:'queued', attempts: supabase.rpc ? undefined : undefined})
    .eq('id', id);
  if(error) throw error;
};

export const enqueueTest=async (tenantId, event='test.ping', payload={ping:true})=>{
  const {error}=await supabase.from('webhook_deliveries').insert({
    tenant_id:tenantId, event, status:'queued', payload
  });
  if(error) throw error;
};
