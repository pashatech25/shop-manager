import React from "react";
import {useNotifications} from "./NotificationsProvider.jsx";

/** Renders nothing by default, so the banner disappears. Use <NotificationCenter inline/> only where you want a list. */
export default function NotificationCenter({inline=false}){
  const {notifications,markRead}=useNotifications();

  if(!inline){ return null; }

  return (
    <div className="card">
      <div className="row">
        <h3 style={{margin:0}}>Notifications</h3>
        <div className="tiny">{notifications.length} items</div>
      </div>
      {notifications.length===0? <div className="tiny">No notifications yet.</div> : null}
      <ul style={{listStyle:"none",padding:0,margin:"8px 0 0 0"}}>
        {notifications.map((n)=>(
          <li key={n.id} className="recent-activity-item" style={{marginBottom:8}}>
            <p><strong>{n.event}</strong> — {n.message||""}</p>
            <p className="tiny">{new Date(n.created_at).toLocaleString()}</p>
            {!n.read_at? <button className="btn tiny" onClick={()=>markRead(n.id)}>Mark read</button> : <span className="tiny" style={{color:"#666"}}>read</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
