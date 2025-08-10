// Tiny helpers so every query is tenant-safe and consistent.

export const withTenant=(tenantId, builder)=>builder.eq('tenant_id', tenantId);

export const insertForTenant=(tenantId, payload)=>({tenant_id:tenantId, ...payload});

// Guard: ensure we never save rows without a tenant_id
export const assertTenant=(tenantId)=>{
  if(!tenantId){throw new Error('No tenant selected or user profile missing tenant_id');}
};
