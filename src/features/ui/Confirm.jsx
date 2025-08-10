// src/features/ui/Confirm.jsx
export default function Confirm({open, title, message, onYes, onNo}){
  if(!open) return null;
  return (
    <div className="modal" onClick={onNo}>
      <div className="modal-content" onClick={(e)=>e.stopPropagation()}>
        <div className="row">
          <h3 style={{margin:0}}>{title||"Confirm"}</h3>
        </div>
        <div style={{marginTop:12}}>
          {message || <p>Are you sure?</p>}
        </div>
        <div className="btn-row" style={{marginTop:16, justifyContent:"flex-end"}}>
          <button className="btn" onClick={onNo}>Cancel</button>
          <button className="btn btn-primary" onClick={onYes}>Yes</button>
        </div>
      </div>
    </div>
  );
}
