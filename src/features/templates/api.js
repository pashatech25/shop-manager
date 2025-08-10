import {supabase} from "../../lib/supabaseClient";

/** List templates for a tenant and kind ('quote' | 'job') */
export async function listTemplates(tenantId, kind){
  if(!tenantId) return {data: [], error: null};
  const {data, error} = await supabase
    .from("templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .order("created_at", {ascending:false});

  return {data: Array.isArray(data) ? data : (data ? [data] : []), error};
}

/** Save a template (insert or update by id) */
export async function saveTemplate(tenantId, kind, name, payload, includeCustomer=false, id=null){
  const body = {tenant_id: tenantId, kind, name, include_customer: includeCustomer, payload};

  if(id){
    const {data, error} = await supabase
      .from("templates")
      .update(body)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    return {data, error};
  }else{
    const {data, error} = await supabase
      .from("templates")
      .insert(body)
      .select("*")
      .single();
    return {data, error};
  }
}

/** Delete template */
export async function deleteTemplate(id, tenantId){
  const {error} = await supabase
    .from("templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  return {error};
}
