import {createClient} from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if(!url || !anon){
  console.warn("[supabaseClient] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env. The app will fail to fetch data until these are set.");
}

export const supabase = createClient(url, anon, {auth:{persistSession:true, autoRefreshToken:true}});

/** Optional helper used by TenantContext/tests */
export const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID || null;
