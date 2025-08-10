import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {listTypes, addType, deleteType} from '../features/types/api.js';
import BrandingUpload from '../features/settings/BrandingUpload.jsx';

const financeSchema=z.object({
  business_name:z.string().min(1,'Required'),
  business_email:z.string().email('Invalid email').optional().or(z.literal('')),
  business_phone:z.string().optional().or(z.literal('')),
  business_address:z.string().optional().or(z.literal('')),
  tax_rate:z.coerce.number().min(0).max(100),
  currency:z.string().min(1),
  brand_primary:z.string().optional().or(z.literal('')),
  brand_secondary:z.string().optional().or(z.literal('')),
  brand_logo_path:z.string().optional().or(z.literal(''))
});

const numberingSchema=z.object({
  quote_prefix:z.string().default('Q-'),
  quote_counter:z.coerce.number().min(0),
  job_prefix:z.string().default('J-'),
  job_counter:z.coerce.number().min(0),
  invoice_prefix:z.string().default('INV-'),
  invoice_counter:z.coerce.number().min(0)
});

const webhookSchema=z.object({
  url:z.string().url('Invalid URL'),
  secret:z.string().optional().or(z.literal('')),
  enabled:z.boolean().default(true),
  evt_quote_created:z.boolean().default(true),
  evt_quote_to_job:z.boolean().default(true),
  evt_job_completed:z.boolean().default(true),
  evt_invoice_generated:z.boolean().default(true),
  evt_low_ink:z.boolean().default(true)
});

export default function Settings(){
  const {tenantId}=useTenant();
  const [loading,setLoading]=useState(true);
  const [row,setRow]=useState(null);

  const f=useForm({resolver:zodResolver(financeSchema), defaultValues:{business_name:'', business_email:'', business_phone:'', business_address:'', tax_rate:0, currency:'USD', brand_primary:'#111111', brand_secondary:'#007bff', brand_logo_path:''}});
  const n=useForm({resolver:zodResolver(numberingSchema), defaultValues:{quote_prefix:'Q-', quote_counter:1, job_prefix:'J-', job_counter:1, invoice_prefix:'INV-', invoice_counter:1}});
  const w=useForm({resolver:zodResolver(webhookSchema), defaultValues:{url:'', secret:'', enabled:false, evt_quote_created:true, evt_quote_to_job:true, evt_job_completed:true, evt_invoice_generated:true, evt_low_ink:true}});

  const [vendorTypes,setVendorTypes]=useState([]);
  const [materialTypes,setMaterialTypes]=useState([]);
  const [newVendorType,setNewVendorType]=useState('');
  const [newMaterialType,setNewMaterialType]=useState('');

  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId) return;
      setLoading(true);
      const [{data:settings}, vtypes, mtypes] = await Promise.all([
        supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        listTypes(tenantId,'vendor'),
        listTypes(tenantId,'material')
      ]).catch((e)=>{ console.error(e); return [{data:null},[],[]]; });

      if(settings){
        setRow(settings);
        f.reset({
          business_name:settings.business_name||'',
          business_email:settings.business_email||'',
          business_phone:settings.business_phone||'',
          business_address:settings.business_address||'',
          tax_rate:settings.tax_rate??0,
          currency:settings.currency||'USD',
          brand_primary:settings.brand_primary||'#111111',
          brand_secondary:settings.brand_secondary||'#007bff',
          brand_logo_path:settings.brand_logo_path||''
        });
        n.reset({
          quote_prefix:settings.quote_prefix||'Q-',
          quote_counter:settings.quote_counter??1,
          job_prefix:settings.job_prefix||'J-',
          job_counter:settings.job_counter??1,
          invoice_prefix:settings.invoice_prefix||'INV-',
          invoice_counter:settings.invoice_counter??1
        });
        w.reset({
          url:settings.webhook_url||'',
          secret:settings.webhook_secret||'',
          enabled:!!settings.webhook_enabled,
          evt_quote_created:!!settings.evt_quote_created,
          evt_quote_to_job:!!settings.evt_quote_to_job,
          evt_job_completed:!!settings.evt_job_completed,
          evt_invoice_generated:!!settings.evt_invoice_generated,
          evt_low_ink:!!settings.evt_low_ink
        });
      }
      setVendorTypes(vtypes||[]);
      setMaterialTypes(mtypes||[]);
      setLoading(false);
    };
    load();
  },[tenantId]);

  const saveFinance=f.handleSubmit(async (vals)=>{
    const payload={tenant_id:tenantId, ...vals};
    const {error}=row
      ? await supabase.from('settings').update(payload).eq('tenant_id', tenantId)
      : await supabase.from('settings').insert(payload);
    if(error){ toast.error(error.message); return; }
    toast.success('Branding & Finance saved');
  });

  const saveNumbering=n.handleSubmit(async (vals)=>{
    const {error}=await supabase.from('settings').update({tenant_id:tenantId, ...vals}).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.success('Numbering saved');
  });

  const saveWebhook=w.handleSubmit(async (vals)=>{
    const payload={
      tenant_id:tenantId,
      webhook_url:vals.url, webhook_secret:vals.secret, webhook_enabled:vals.enabled,
      evt_quote_created:vals.evt_quote_created, evt_quote_to_job:vals.evt_quote_to_job, evt_job_completed:vals.evt_job_completed, evt_invoice_generated:vals.evt_invoice_generated, evt_low_ink:vals.evt_low_ink
    };
    const {error}=await supabase.from('settings').update(payload).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.success('Webhooks saved');
  });

  const addVendorType=async ()=>{ const name=newVendorType.trim(); if(!name) return; const r=await addType(tenantId,'vendor',name); setVendorTypes((xs)=>[...xs,r]); setNewVendorType(''); toast.success('Vendor type added'); };
  const delVendorType=async (id)=>{ await deleteType(tenantId,id); setVendorTypes((xs)=>xs.filter((x)=>x.id!==id)); toast.info('Deleted'); };

  const addMaterialType=async ()=>{ const name=newMaterialType.trim(); if(!name) return; const r=await addType(tenantId,'material',name); setMaterialTypes((xs)=>[...xs,r]); setNewMaterialType(''); toast.success('Material type added'); };
  const delMaterialType=async (id)=>{ await deleteType(tenantId,id); setMaterialTypes((xs)=>xs.filter((x)=>x.id!==id)); toast.info('Deleted'); };

  return (
    <section className="section">
      <div className="section-header"><h2>Settings</h2>{loading? <span className="tiny">Loading…</span>:null}</div>

      {/* Branding */}
      <div className="card" style={{marginBottom:16}}>
        <h3>Branding</h3>
        <form onSubmit={saveFinance} className="grid-3" style={{marginTop:8}}>
          <div className="group"><label>Business Name</label><input {...f.register('business_name')}/></div>
          <div className="group"><label>Email</label><input type="email" {...f.register('business_email')}/></div>
          <div className="group"><label>Phone</label><input {...f.register('business_phone')}/></div>
          <div className="group" style={{gridColumn:'1 / -1'}}><label>Address</label><textarea rows={2} {...f.register('business_address')}/></div>

          <div className="group"><label>Primary Color</label><input type="color" {...f.register('brand_primary')}/></div>
          <div className="group"><label>Secondary Color</label><input type="color" {...f.register('brand_secondary')}/></div>
          <div className="group" style={{gridColumn:'1 / -1'}}>
            <BrandingUpload logoPath={f.watch('brand_logo_path')} onChange={(p)=>f.setValue('brand_logo_path', p||'')}/>
          </div>

          <div className="group"><label>Tax Rate %</label><input type="number" step="0.01" {...f.register('tax_rate')}/></div>
          <div className="group"><label>Currency</label><input {...f.register('currency')}/></div>

          <div style={{gridColumn:'1 / -1'}}><button className="btn btn-primary">Save Branding & Finance</button></div>
        </form>
      </div>

      {/* Numbering */}
      <div className="card" style={{marginBottom:16}}>
        <h3>Numbering</h3>
        <form onSubmit={n.handleSubmit(saveNumbering)} className="grid-3" style={{marginTop:8}}>
          <div className="group"><label>Quote Prefix</label><input {...n.register('quote_prefix')}/></div>
          <div className="group"><label>Quote Counter</label><input type="number" {...n.register('quote_counter')}/></div>
          <div className="group"><label>Job Prefix</label><input {...n.register('job_prefix')}/></div>
          <div className="group"><label>Job Counter</label><input type="number" {...n.register('job_counter')}/></div>
          <div className="group"><label>Invoice Prefix</label><input {...n.register('invoice_prefix')}/></div>
          <div className="group"><label>Invoice Counter</label><input type="number" {...n.register('invoice_counter')}/></div>
          <div style={{gridColumn:'1 / -1'}}><button className="btn btn-primary">Save Numbering</button></div>
        </form>
      </div>

      {/* Custom Types */}
      <div className="card" style={{marginBottom:16}}>
        <h3>Custom Types</h3>
        <div className="grid-2" style={{marginTop:8}}>
          <div>
            <label className="tiny">Vendor Types</label>
            <div className="chips" style={{marginTop:8}}>
              {vendorTypes.map((t)=>(
                <span key={t.id} className="chip">{t.name}<button className="x" onClick={()=>delVendorType(t.id)}>&times;</button></span>
              ))}
            </div>
            <div className="row" style={{marginTop:8}}>
              <input placeholder="Add vendor type" value={newVendorType} onChange={(e)=>setNewVendorType(e.target.value)}/>
              <button className="btn btn-primary" onClick={addVendorType}>Add</button>
            </div>
          </div>
          <div>
            <label className="tiny">Material Types</label>
            <div className="chips" style={{marginTop:8}}>
              {materialTypes.map((t)=>(
                <span key={t.id} className="chip">{t.name}<button className="x" onClick={()=>delMaterialType(t.id)}>&times;</button></span>
              ))}
            </div>
            <div className="row" style={{marginTop:8}}>
              <input placeholder="Add material type" value={newMaterialType} onChange={(e)=>setNewMaterialType(e.target.value)}/>
              <button className="btn btn-primary" onClick={addMaterialType}>Add</button>
            </div>
          </div>
        </div>
      </div>

      {/* Webhooks */}
      <div className="card">
        <h3>Webhooks</h3>
        <form onSubmit={w.handleSubmit(saveWebhook)} className="grid-3" style={{marginTop:8}}>
          <div className="group" style={{gridColumn:'1 / -1'}}><label>Endpoint URL</label><input {...w.register('url')}/></div>
          <div className="group"><label>Secret (optional)</label><input {...w.register('secret')}/></div>
          <div className="group"><label>Enabled</label>
            <select {...w.register('enabled')}> <option value="true">Yes</option><option value="false">No</option> </select>
          </div>
          <div className="group"><label>Quote Created</label><input type="checkbox" {...w.register('evt_quote_created')}/></div>
          <div className="group"><label>Quote → Job</label><input type="checkbox" {...w.register('evt_quote_to_job')}/></div>
          <div className="group"><label>Job Completed</label><input type="checkbox" {...w.register('evt_job_completed')}/></div>
          <div className="group"><label>Invoice Generated</label><input type="checkbox" {...w.register('evt_invoice_generated')}/></div>
          <div className="group"><label>Low Ink</label><input type="checkbox" {...w.register('evt_low_ink')}/></div>
          <div style={{gridColumn:'1 / -1'}}><button className="btn btn-primary">Save Webhooks</button></div>
        </form>
      </div>
    </section>
  );
}
