import {useEffect} from "react";
import {supabase} from "../../lib/superbase.js";
import {useTenant} from "../../context/TenantContext.jsx";
import {toast} from "react-toastify";

export default function NotificationsListener(){
  const {tenantId}=useTenant();

  useEffect(()=>{
    if(!tenantId) return;
    // Realtime: listen to inserts into public.notifications for this tenant
    const channel = supabase
      .channel(`notif-${tenantId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `tenant_id=eq.${tenantId}`
      }, (payload)=>{
        try{
          const row = payload.new || payload.record;
          const title = row?.event || "Notification";
          const msg = row?.message || row?.payload?.message || "";
          toast.info(`${title}${msg? ` — ${msg}`:""}`, {autoClose:5000});
        }catch(err){
          console.error("notification toast error", err);
        }
      })
      .subscribe((status)=>{ /* noop: you can log status if needed */ });

    return ()=>{ supabase.removeChannel(channel); };
  },[tenantId]);

  // No visible UI — this kills the “Notifications 0 items” banner
  return null;
}
