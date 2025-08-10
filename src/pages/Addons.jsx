import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';

const schema=z.object({
  name:z.string().min(1,'Required'),
  description:z.string().optional().or(z.literal(''))
});

export default function Addons(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const f=useForm({resolver:zodResolver(schema), defaultValues:{name:'', description:''}});
  const [editing,setEditing]=useState(null);

  const load=async ()=>{
    if(!tenantId) return;
    const {data}=await supabase.from('addons').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false});
    setRows(data||[]);
  };

  useEffect(()=>{ load(); },[tenantId]);

  const edit=(r)=>{ setEditing(r); f.reset({...r}); };
  const clear=()=>{ setEditing(null); f.reset({name:'', description:''}); };

  const save=f.handleSubmit(async (vals)=>{
    if(editing){
      const {error}=await supabase.from('addons').update({...vals}).eq('id', editing.id).eq('tenant_id', tenantId);
      if(error){ toast.error(error.message); return; }
      toast.success('Add-on updated');
    } else {
      const {error}=await supabase.from('addons').insert([{tenant_id:tenantId, ...vals}]);
      if(error){ toast.error(error.message); return; }
      toast.success('Add-on added');
    }
    clear(); load();
  });

  const remove=async (r)=>{
    if(!confirm('Delete add-on?')) return;
    const {error}=await supabase.from('addons').delete().eq('id', r.id).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.info('Add-on deleted'); load();
  };

  return (
    <section className="section">
      <div className="section-header"><h2>Add-ons</h2></div>

      <div className="grid-2">
        <div className="card">
          <h3>{editing?'Edit Add-on':'New Add-on'}</h3>
          <form onSubmit={save} className="grid-1" style={{marginTop:8}}>
            <div className="group"><label>Name</label><input {...f.register('name')}/><Err f={f} n="name"/></div>
            <div className="group"><label>Description</label><textarea rows={2} {...f.register('description')}/></div>
            <div className="btn-row">
              <button className="btn btn-primary">{editing?'Save':'Create'}</button>
              {editing? <button type="button" className="btn btn-secondary" onClick={clear}>Cancel</button>:null}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>All Add-ons</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Description</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
              <tbody>
                {rows.map((r)=>(
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="tiny">{r.description||'—'}</td>
                    <td style={{textAlign:'right'}}>
                      <div className="btn-row" style={{justifyContent:'flex-end'}}>
                        <button className="btn" onClick={()=>edit(r)}>Edit</button>
                        <button className="btn btn-danger" onClick={()=>remove(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length===0? <tr><td colSpan={3} className="tiny">No add-ons yet.</td></tr>:null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Err({f,n}){ const e=f.formState.errors?.[n]; return e? <span className="tiny" style={{color:'#c92a2a'}}>{e.message}</span>:null; }
