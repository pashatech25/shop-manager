import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {ToastContainer, toast} from 'react-toastify';
import {supabase} from '../../lib/superbase.js';
import {useTenant} from '../../context/TenantContext.jsx';

const NotifCtx=createContext({items:[], push:()=>{}});
export const useNotifications=()=>useContext(NotifCtx);

// Shows react-toastify toasts and subscribes to Supabase Realtime on notifications table.
export default function NotificationsProvider({children}){
  const {tenantId}=useTenant();
  const [items,setItems]=useState([]);
  const channelRef=useRef(null);

  // initial load
  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId){setItems([]); return;}
      const {data,error}=await supabase.from('notifications')
        .select('*').eq('tenant_id', tenantId)
        .order('created_at',{ascending:false}).limit(20);
      if(error){console.error(error); return;}
      setItems(data||[]);
    };
    load();
  },[tenantId]);

  // realtime subscription
  useEffect(()=>{
    if(channelRef.current){ supabase.removeChannel(channelRef.current); channelRef.current=null; }
    if(!tenantId){return;}

    const ch=supabase.channel(`notif-${tenantId}`)
      .on('postgres_changes',{
        event:'INSERT',
        schema:'public',
        table:'notifications',
        filter:`tenant_id=eq.${tenantId}`
      },(payload)=>{
        const row=payload.new;
        setItems((xs)=>[row,...xs].slice(0,40));
        toast.info(row.message||row.kind||'Notification');
      })
      .subscribe((status)=>{
        if(status==='SUBSCRIBED'){ /* ready */ }
      });

    channelRef.current=ch;
    return ()=>{ if(channelRef.current){ supabase.removeChannel(channelRef.current); channelRef.current=null; } };
  },[tenantId]);

  const push=(n)=>{
    setItems((xs)=>[n,...xs].slice(0,40));
    toast.info(n.message||n.kind||'Notification');
  };

  const value=useMemo(()=>({items, push}),[items]);

  return (
    <NotifCtx.Provider value={value}>
      {children}
      <ToastContainer position="top-right" autoClose={3500} hideProgressBar={false} newestOnTop={true} closeOnClick rtl={false} pauseOnFocusLoss draggable pauseOnHover/>
    </NotifCtx.Provider>
  );
}
