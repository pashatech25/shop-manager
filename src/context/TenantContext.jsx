import React, {createContext, useContext, useEffect, useMemo, useState} from "react";
import {supabase} from "../lib/supabaseClient";
import {defaultTenantId as ENV_DEFAULT_TENANT} from "../lib/supabaseClient";

/**
 * Resolves tenantId for the current user:
 * 1) If logged in, fetch `profiles.tenant_id` for auth.uid()
 * 2) Else, fall back to VITE_DEFAULT_TENANT_ID (for local testing)
 */
const TenantCtx = createContext({tenantId:null, setTenantId:()=>{}});

export function TenantProvider({children}){
  const [tenantId,setTenantId] = useState(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");

  useEffect(()=>{
    let cancelled=false;
    const run = async ()=>{
      setLoading(true);
      setError("");

      try{
        // get current session (if any)
        const {data:{session}} = await supabase.auth.getSession();
        const uid = session?.user?.id || null;

        if(uid){
          // fetch profile → tenant_id
          const {data, error} = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("user_id", uid)
            .limit(1)
            .maybeSingle();
          if(error) throw error;
          const t = data?.tenant_id || null;
          if(!cancelled) setTenantId(t);
        }else{
          // no session: fall back to .env default (handy for dev)
          if(!cancelled) setTenantId(ENV_DEFAULT_TENANT || null);
        }
      }catch(ex){
        if(!cancelled){
          setError(ex.message||"Failed to resolve tenant");
          setTenantId(ENV_DEFAULT_TENANT || null);
        }
      }finally{
        if(!cancelled) setLoading(false);
      }
    };

    run();

    // also react to auth changes
    const {data: sub} = supabase.auth.onAuthStateChange((_event)=>{
      run();
    });

    return ()=>{ cancelled=true; sub?.subscription?.unsubscribe?.(); };
  },[]);

  const value = useMemo(()=>({tenantId, setTenantId, loading, error}), [tenantId, loading, error]);
  return <TenantCtx.Provider value={value}>{children}</TenantCtx.Provider>;
}

export function useTenant(){ return useContext(TenantCtx); }
