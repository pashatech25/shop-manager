import React, {createContext, useContext, useEffect, useMemo, useState} from "react";
import {supabase} from "../../lib/supabaseClient";
import {useTenant} from "../../context/TenantContext.jsx";
import {toast} from "react-toastify";

const NotificationsCtx = createContext(null);

export function NotificationsProvider({children}){
  const {tenantId}=useTenant();
  const [notifications,setNotifications]=useState([]);

  const load=async ()=>{
    if(!tenantId){ setNotifications([]); return; }
    const {data,error}=await supabase
      .from("notifications")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at",{ascending:false})
      .limit(50);
    if(!error){ setNotifications(data||[]); }
  };

  useEffect(()=>{ load(); },[tenantId]);

  useEffect(()=>{
    if(!tenantId) return;
    const ch=supabase
      .channel(`notif-${tenantId}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"notifications",filter:`tenant_id=eq.${tenantId}`},(payload)=>{
        const row=payload.new || payload.record;
        setNotifications((xs)=>[row,...xs]);
        const title=row?.event || "Notification";
        const msg=row?.message || row?.payload?.message || "";
        toast.info(`${title}${msg?` — ${msg}`:""}`,{autoClose:5000});
      })
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[tenantId]);

  const push=async ({event,message,payload})=>{
    if(!tenantId) return;
    const {data,error}=await supabase.from("notifications").insert({
      tenant_id:tenantId, event, message:message||null, payload:payload||null
    }).select("*").single();
    if(!error && data){ setNotifications((xs)=>[data,...xs]); }
  };

  const markRead=async (id)=>{
    if(!tenantId || !id) return;
    const {data,error}=await supabase
      .from("notifications")
      .update({read_at:new Date().toISOString()})
      .eq("id", id).eq("tenant_id", tenantId)
      .select("*").single();
    if(!error && data){ setNotifications((xs)=>xs.map((n)=>n.id===id? data:n)); }
  };

  const value=useMemo(()=>({notifications,push,markRead}),[notifications]);
  return <NotificationsCtx.Provider value={value}>{children}</NotificationsCtx.Provider>;
}

export function useNotifications(){ return useContext(NotificationsCtx); }
