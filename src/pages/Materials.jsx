import {useEffect, useMemo, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {listTypes, addType} from '../features/types/api.js';
import ImageUpload from '../features/materials/ImageUpload.jsx';

const schema=z.object({
  name:z.string().min(1,'Required'),
  vendor_id:z.string().optional().or(z.literal('')),
  type_id:z.string().optional().or(z.literal('')),
  description:z.string().optional().or(z.literal('')),
  image_path:z.string().optional().or(z.literal('')),
  purchase_price:z.coerce.number().min(0),
  selling_price:z.coerce.number().min(0),
  on_hand:z.coerce.number().min(0),
  reserved:z.coerce.number().min(0).default(0),
  reorder_threshold:z.coerce.number().min(0).default(0)
});

export default function Materials(){
  const {tenantId}=useTenant();
  const [rows,setRows]=useState([]);
  const [vendors,setVendors]=useState([]);
  const [types,setTypes]=useState([]);
  const [addingType,setAddingType]=useState('');
  const f=useForm({resolver:zodResolver(schema), defaultValues:{name:'', vendor_id:'', type_id:'', description:'', image_path:'', purchase_price:0, selling_price:0, on_hand:0, reserved:0, reorder_threshold:0}});
  const [editing,setEditing]=useState(null);

  const load=async ()=>{
    if(!tenantId) return;
    const [{data:mats},{data:vs}] = await Promise.all([
      supabase.from('materials').select('*').eq('tenant_id', tenantId).order('created_at',{ascending:false}),
      supabase.from('vendors').select('id,name').eq('tenant_id', tenantId).order('name')
    ]);
    setRows(mats||[]);
    setVendors(vs||[]);
    setTypes(await listTypes(tenantId,'material'));
  };

  useEffect(()=>{ load(); },[tenantId]);

  const edit=(r)=>{ setEditing(r); f.reset({...r}); };
  const clear=()=>{ setEditing(null); f.reset({name:'', vendor_id:'', type_id:'', description:'', image_path:'', purchase_price:0, selling_price:0, on_hand:0, reserved:0, reorder_threshold:0}); };

  const save=f.handleSubmit(async (vals)=>{
    if(editing){
      const {error}=await supabase.from('materials').update({...vals}).eq('id', editing.id).eq('tenant_id', tenantId);
      if(error){ toast.error(error.message); return; }
      toast.success('Material updated');
    } else {
      const {error}=await supabase.from('materials').insert([{tenant_id:tenantId, ...vals}]);
      if(error){ toast.error(error.message); return; }
      toast.success('Material added');
    }
    clear(); load();
  });

  const remove=async (r)=>{
    if(!confirm('Delete material?')) return;
    const {error}=await supabase.from('materials').delete().eq('id', r.id).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.info('Material deleted'); load();
  };

  const addMaterialType=async ()=>{
    const name=addingType.trim(); if(!name) return;
    const row=await addType(tenantId,'material',name);
    setTypes((xs)=>[...xs,row]); setAddingType(''); toast.success('Type added');
  };

  const profit=useMemo(()=>{
    const p=(f.watch('selling_price')||0)-(f.watch('purchase_price')||0);
    const base=(f.watch('purchase_price')||0);
    const pct=base>0? (p/base)*100 : 0;
    return {p:to2(p), pct:to2(pct)};
  },[f.watch('selling_price'), f.watch('purchase_price')]);

  return (
    <section className="section">
      <div className="section-header"><h2>Materials</h2></div>

      <div className="grid-2">
        <div className="card">
          <h3>{editing?'Edit Material':'New Material'}</h3>
          <form onSubmit={save} className="grid-2" style={{marginTop:8}}>
            <div className="group"><label>Name</label><input {...f.register('name')}/><Err f={f} n="name"/></div>
            <div className="group">
              <label>Vendor</label>
              <select {...f.register('vendor_id')}>
                <option value="">—</option>
                {vendors.map((v)=> <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="group">
              <label>Type</label>
              <select {...f.register('type_id')}>
                <option value="">—</option>
                {types.map((t)=> <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <div className="row" style={{marginTop:8}}>
                <input placeholder="Add new type" value={addingType} onChange={(e)=>setAddingType(e.target.value)}/>
                <button type="button" className="btn" onClick={addMaterialType}>Add Type</button>
              </div>
            </div>
            <div className="group" style={{gridColumn:'1 / -1'}}><label>Description</label><textarea rows={2} {...f.register('description')}/></div>

            <div className="group" style={{gridColumn:'1 / -1'}}>
              <ImageUpload value={f.watch('image_path')} onChange={(v)=>f.setValue('image_path', v||'')}/>
            </div>

            <div className="group"><label>Purchase Price</label><input type="number" step="0.01" {...f.register('purchase_price')}/><Err f={f} n="purchase_price"/></div>
            <div className="group"><label>Selling Price</label><input type="number" step="0.01" {...f.register('selling_price')}/><Err f={f} n="selling_price"/></div>
            <div className="group"><label>On Hand</label><input type="number" step="1" {...f.register('on_hand')}/><Err f={f} n="on_hand"/></div>
            <div className="group"><label>Reserved</label><input type="number" step="1" {...f.register('reserved')}/></div>
            <div className="group"><label>Reorder Threshold</label><input type="number" step="1" {...f.register('reorder_threshold')}/></div>

            <div className="card" style={{gridColumn:'1 / -1'}}>
              <p className="tiny">Profit per unit: <b>${profit.p}</b> &nbsp; Margin: <b>{profit.pct}%</b></p>
            </div>

            <div style={{gridColumn:'1 / -1'}} className="btn-row">
              <button className="btn btn-primary">{editing?'Save':'Create'}</button>
              {editing? <button type="button" className="btn btn-secondary" onClick={clear}>Cancel</button>:null}
            </div>
          </form>
        </div>

        <div className="card">
          <h3>All Materials</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Vendor</th><th>On Hand</th><th>Reserved</th><th>Threshold</th><th style={{textAlign:'right'}}>Actions</th></tr></thead>
              <tbody>
                {rows.map((r)=>(
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="tiny">{vendors.find((v)=>v.id===r.vendor_id)?.name||'—'}</td>
                    <td>{r.on_hand??0}</td>
                    <td>{r.reserved??0}</td>
                    <td>{r.reorder_threshold??0}</td>
                    <td style={{textAlign:'right'}}>
                      <div className="btn-row" style={{justifyContent:'flex-end'}}>
                        <button className="btn" onClick={()=>edit(r)}>Edit</button>
                        <button className="btn btn-danger" onClick={()=>remove(r)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length===0? <tr><td colSpan={6} className="tiny">No materials yet.</td></tr>:null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function to2(n){ return Number((+n||0).toFixed(2)); }
function Err({f,n}){ const e=f.formState.errors?.[n]; return e? <span className="tiny" style={{color:'#c92a2a'}}>{e.message}</span>:null; }
