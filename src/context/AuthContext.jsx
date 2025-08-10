import React, {createContext, useContext, useEffect, useState} from "react";
import {supabase} from "../lib/supabaseClient";

const AuthCtx = createContext(null);

export function AuthProvider({children}){
  const [session,setSession] = useState(null);
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    let ignore=false;
    const init=async()=>{
      const {data:{session}} = await supabase.auth.getSession();
      if(!ignore) setSession(session||null);
      setLoading(false);
    };
    init();
    const {data:sub} = supabase.auth.onAuthStateChange((_event, session)=>{
      setSession(session||null);
    });
    return ()=>{ignore=true; sub?.subscription?.unsubscribe?.();};
  },[]);

  return (
    <AuthCtx.Provider value={{session,loading}}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(){ return useContext(AuthCtx); }
