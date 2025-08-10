import {useNotifications} from './NotificationsProvider.jsx';

export default function NotificationCenter(){
  const {items}=useNotifications();
  return (
    <section className="section">
      <div className="section-header"><h2>Notifications</h2><span className="tiny">{items.length} items</span></div>
      <div className="cards">
        {items.map((n)=>(
          <div key={n.id || `${n.created_at}-${n.message}`} className="recent-activity-item">
            <p><b>{n.kind||'notice'}</b> — {n.message||''}</p>
            <p className="tiny">{fmt(n.created_at)}</p>
          </div>
        ))}
        {items.length===0? <div className="tiny">No notifications yet.</div> : null}
      </div>
    </section>
  );
}

function fmt(s){ try{ return new Date(s).toLocaleString(); }catch{ return s||''; } }
