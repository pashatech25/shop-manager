import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {listTypes, addType} from '../features/types/api.js';
import FormError from '../features/ui/FormError.jsx';

const schema=z.object({
  name:z.string().min(1,'Required'),
  email:z.string().email('Invalid email').optional().or(z.literal('')),
  phone:z.string().optional().or(z.literal('')),
  website:z.string().url('Invalid URL').optional().or(z.literal('')),
  address:z.string().optional().or(z.literal('')),
  type_id:z.string().optional().or(z.literal(''))
});

export default function Vendors(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [types,setTypes]=useState([]);
  const f=useForm({resolver:zodResolver(schema), defaultValues:{name:'', email:'', phone:'', website:'', address:'', type_id:''}});
  const [editing,setEditing]=useState(null);
  const [addingType,setAddingType]=useState('');

  const load=async ()=>{
    if(!tenantId) return;
    const {data:vs}=await supabase.from('vendors').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false});
    setRows(vs||[]);
    setTypes(await listTypes(tenantId,'vendor'));
  };

  useEffect(()=>{ load(); },[tenantId]);

  const edit=(r)=>{ setEditing(r); f.reset({...r}); };
  const clear=()=>{ setEditing(null); f.reset({name:'', email:'', phone:'', website:'', address:'', type_id:''}); };

  const save=f.handleSubmit(async (vals)=>{
    if(editing){
      const {error}=await supabase.from('vendors').update({...vals}).eq('id', editing.id).eq('tenant_id', tenantId);
      if(error){ toast.error(error.message); return; }
      toast.success('Vendor updated');
    } else {
      const {error}=await supabase.from('vendors').insert([{tenant_id:tenantId, ...vals}]);
      if(error){ toast.error(error.message); return; }
      toast.success('Vendor added');
    }
    clear(); load();
  });

  const remove=async (r)=>{
    if(!confirm('Delete vendor?')) return;
    const {error}=await supabase.from('vendors').delete().eq('id', r.id).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.info('Vendor deleted'); load();
  };

  const addVendorType=async ()=>{
    const name=addingType.trim(); if(!name) return;
    const row=await addType(tenantId,'vendor',name);
    setTypes((xs)=>[...xs,row]);
    setAddingType(''); toast.success('Type added');
  };

  return (
    <section className="section">
      <div className="section-header"><h2>Vendors</h2></div>

      <div className="grid-2">
        <div className="card">
          <h3>{editing?'Edit Vendor':'New Vendor'}</h3>
          <form onSubmit={save} className="grid-2" style={{marginTop:8}}>
            <div className="group"><label>Name</label><input {...f.register('name')}/><FormError errors={f.formState.errors} name="name"/></div>
            <div className="group"><label>Email</label><input type="email" {...f.register('email')}/><FormError errors={f.formState.errors} name="email"/></div>
            <div className="group"><label>Phone</label><input {...f.register('phone')}/></div>
            <div className="group"><label>Website</label><input {...f.register('website')}/><FormError errors={f.formState.errors} name="website"/></div>
            <div className="group" style={{gridColumn:'1 / -1'}}><label>Address</label><textarea rows={2} {...f.register('address')}/></div>
            <div className="group" style={{gridColumn:'1 / -1'}}>
              <label>Type</label>
              <select {...f.register('type_id')}>
                <option value="">—</option>
                {types.map((t)=> <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="row" style={{marginTop:8}}>
                <input placeholder="Add new type" value={addingType} onChange={(e)=>setAddingType(e.target.value)}/>
                <button className="btn" type="button" onClick={addVendorType}>Add Type</button>
              </div>
            </div>
            <div style={{gridColumn:'1 / -1'}} className="btn-row">
              <button className="btn btn-primary">{editing?'Save':'Create'}</button>
              {editing? <button type="button" className="btn btn-secondary" onClick={clear}>Cancel</button>:null}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>All Vendors</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Type</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
              <tbody>
                {rows.map((r)=>(
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="tiny">{r.email||'—'}</td>
                    <td className="tiny">{types.find((t)=>t.id===r.type_id)?.name||'—'}</td>
                    <td style={{textAlign:'right'}}>
                      <div className="btn-row" style={{justifyContent:'flex-end'}}>
                        <button className="btn" onClick={()=>edit(r)}>Edit</button>
                        <button className="btn btn-danger" onClick={()=>remove(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length===0? <tr><td colSpan={4} className="tiny">No vendors yet.</td></tr>:null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
