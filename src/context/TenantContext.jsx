import React, {createContext, useContext, useEffect, useMemo, useState} from "react";
import {supabase} from "../lib/superbase.js"; // keep your existing import path

const TenantCtx = createContext({ tenantId: null, ready: false });

export function TenantProvider({children}) {
  const [tenantId, setTenantId] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveTenant() {
      setReady(false);

      // 1) Get current session
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id || null;
      const email = session?.user?.email || null;

      // 2) Local dev override (kept for your flow)
      const localDefault = import.meta.env.VITE_DEFAULT_TENANT_ID;
      if (!uid && localDefault) {
        if (!cancelled) {
          setTenantId(localDefault);
          setReady(true);
        }
        return;
      }

      if (!uid) {
        // not logged in yet
        if (!cancelled) {
          setTenantId(null);
          setReady(true);
        }
        return;
      }

      try {
        // 3) Ask the DB to ensure profile+tenant, and give us the tenant_id
        const { data, error } = await supabase.rpc("ensure_profile_and_tenant", {
          _user_id: uid,
          _email: email
        });

        if (error) {
          console.warn("ensure_profile_and_tenant error:", error);
          // last resort: try to read profile.tenant_id directly
          const { data: prof, error: e2 } = await supabase
            .from("profiles")
            .select("tenant_id")
            .eq("user_id", uid)
            .single();
          if (e2) throw e2;
          if (!cancelled) {
            setTenantId(prof?.tenant_id ?? null);
            setReady(true);
          }
          return;
        }

        if (!cancelled) {
          setTenantId(data ?? null);
          setReady(true);
        }
      } catch (ex) {
        console.error("TenantContext resolve failure:", ex);
        if (!cancelled) {
          setTenantId(null);
          setReady(true);
        }
      }
    }

    resolveTenant();

    // 4) Update when auth state changes (switch user, logout, etc.)
    const { data: sub } = supabase.auth.onAuthStateChange((_event) => {
      // Re-run the resolution flow on any auth change
      resolveTenant();
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const value = useMemo(() => ({ tenantId, ready }), [tenantId, ready]);

  return (
    <TenantCtx.Provider value={value}>
      {children}
    </TenantCtx.Provider>
  );
}

export function useTenant() {
  return useContext(TenantCtx);
}
