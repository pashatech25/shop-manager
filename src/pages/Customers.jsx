import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';

const schema=z.object({
  company:z.string().optional().or(z.literal('')),
  name:z.string().min(1,'Required'),
  email:z.string().email('Invalid email').optional().or(z.literal('')),
  phone:z.string().optional().or(z.literal('')),
  website:z.string().url('Invalid URL').optional().or(z.literal('')),
  address:z.string().optional().or(z.literal(''))
});

export default function Customers(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const f=useForm({resolver:zodResolver(schema), defaultValues:{company:'', name:'', email:'', phone:'', website:'', address:''}});
  const [editing,setEditing]=useState(null);

  const load=async ()=>{
    if(!tenantId) return;
    const {data}=await supabase.from('customers').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false});
    setRows(data||[]);
  };

  useEffect(()=>{ load(); },[tenantId]);

  const edit=(r)=>{ setEditing(r); f.reset({...r}); };
  const clear=()=>{ setEditing(null); f.reset({company:'', name:'', email:'', phone:'', website:'', address:''}); };

  const save=f.handleSubmit(async (vals)=>{
    if(editing){
      const {error}=await supabase.from('customers').update({...vals}).eq('id', editing.id).eq('tenant_id', tenantId);
      if(error){ toast.error(error.message); return; }
      toast.success('Customer updated');
    } else {
      const {error}=await supabase.from('customers').insert([{tenant_id:tenantId, ...vals}]);
      if(error){ toast.error(error.message); return; }
      toast.success('Customer added');
    }
    clear(); load();
  });

  const remove=async (r)=>{
    if(!confirm('Delete customer?')) return;
    const {error}=await supabase.from('customers').delete().eq('id', r.id).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.info('Customer deleted'); load();
  };

  return (
    <section className="section">
      <div className="section-header"><h2>Customers</h2></div>

      <div className="grid-2">
        <div className="card">
          <h3>{editing?'Edit Customer':'New Customer'}</h3>
          <form onSubmit={save} className="grid-2" style={{marginTop:8}}>
            <div className="group"><label>Company</label><input {...f.register('company')}/></div>
            <div className="group"><label>Name</label><input {...f.register('name')}/><Err f={f} n="name"/></div>
            <div className="group"><label>Email</label><input type="email" {...f.register('email')}/><Err f={f} n="email"/></div>
            <div className="group"><label>Phone</label><input {...f.register('phone')}/></div>
            <div className="group"><label>Website</label><input {...f.register('website')}/><Err f={f} n="website"/></div>
            <div className="group" style={{gridColumn:'1 / -1'}}><label>Address</label><textarea rows={2} {...f.register('address')}/></div>
            <div style={{gridColumn:'1 / -1'}} className="btn-row">
              <button className="btn btn-primary">{editing?'Save':'Create'}</button>
              {editing? <button type="button" className="btn btn-secondary" onClick={clear}>Cancel</button>:null}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>All Customers</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Company</th><th>Email</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
              <tbody>
                {rows.map((r)=>(
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="tiny">{r.company||'—'}</td>
                    <td className="tiny">{r.email||'—'}</td>
                    <td style={{textAlign:'right'}}>
                      <div className="btn-row" style={{justifyContent:'flex-end'}}>
                        <button className="btn" onClick={()=>edit(r)}>Edit</button>
                        <button className="btn btn-danger" onClick={()=>remove(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length===0? <tr><td colSpan={4} className="tiny">No customers yet.</td></tr>:null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function Err({f,n}){ const e=f.formState.errors?.[n]; return e? <span className="tiny" style={{color:'#c92a2a'}}>{e.message}</span>:null; }
