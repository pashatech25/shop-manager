import {useEffect, useState} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {listTypes, addType, deleteType} from '../features/types/api.js';
import BrandingUpload from '../features/settings/BrandingUpload.jsx';

/** ----- Schemas (unchanged for the parts you already had) ----- */
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

/** Per-trigger webhook schema */
const webhookSchema=z.object({
  // Quote Created
  webhook_quote_created_enabled: z.coerce.boolean().default(false),
  webhook_quote_created_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_quote_created_secret: z.string().optional().or(z.literal('')),

  // Quote -> Job
  webhook_quote_to_job_enabled: z.coerce.boolean().default(false),
  webhook_quote_to_job_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_quote_to_job_secret: z.string().optional().or(z.literal('')),

  // Job Completed
  webhook_job_completed_enabled: z.coerce.boolean().default(false),
  webhook_job_completed_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_job_completed_secret: z.string().optional().or(z.literal('')),

  // Invoice Generated
  webhook_invoice_generated_enabled: z.coerce.boolean().default(false),
  webhook_invoice_generated_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_invoice_generated_secret: z.string().optional().or(z.literal('')),

  // Low Ink
  webhook_low_ink_enabled: z.coerce.boolean().default(false),
  webhook_low_ink_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_low_ink_secret: z.string().optional().or(z.literal('')),

  // Low Materials
  webhook_low_materials_enabled: z.coerce.boolean().default(false),
  webhook_low_materials_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_low_materials_secret: z.string().optional().or(z.literal('')),
});

export default function Settings(){
  const {tenantId}=useTenant();
  const [loading,setLoading]=useState(true);
  const [row,setRow]=useState(null);

  // Keep your existing forms
  const f=useForm({
    resolver:zodResolver(financeSchema),
    defaultValues:{
      business_name:'', business_email:'', business_phone:'', business_address:'',
      tax_rate:0, currency:'USD', brand_primary:'#111111', brand_secondary:'#007bff', brand_logo_path:''
    }
  });

  const n=useForm({
    resolver:zodResolver(numberingSchema),
    defaultValues:{quote_prefix:'Q-', quote_counter:1, job_prefix:'J-', job_counter:1, invoice_prefix:'INV-', invoice_counter:1}
  });

  // Per-trigger webhooks form (single form with all fields)
  const w=useForm({
    resolver:zodResolver(webhookSchema),
    defaultValues:{
      webhook_quote_created_enabled:false,
      webhook_quote_created_url:'', webhook_quote_created_secret:'',

      webhook_quote_to_job_enabled:false,
      webhook_quote_to_job_url:'', webhook_quote_to_job_secret:'',

      webhook_job_completed_enabled:false,
      webhook_job_completed_url:'', webhook_job_completed_secret:'',

      webhook_invoice_generated_enabled:false,
      webhook_invoice_generated_url:'', webhook_invoice_generated_secret:'',

      webhook_low_ink_enabled:false,
      webhook_low_ink_url:'', webhook_low_ink_secret:'',

      webhook_low_materials_enabled:false,
      webhook_low_materials_url:'', webhook_low_materials_secret:'',
    }
  });

  const [vendorTypes,setVendorTypes]=useState([]);
  const [materialTypes,setMaterialTypes]=useState([]);
  const [newVendorType,setNewVendorType]=useState('');
  const [newMaterialType,setNewMaterialType]=useState('');

  useEffect(()=>{
    const load=async ()=>{
      if(!tenantId) return;
      setLoading(true);
      try{
        const [{data:settings}, vtypes, mtypes] = await Promise.all([
          supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
          listTypes(tenantId,'vendor'),
          listTypes(tenantId,'material')
        ]);

        if(settings){
          setRow(settings);
          // Branding/finance
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

          // Numbering
          n.reset({
            quote_prefix:settings.quote_prefix||'Q-',
            quote_counter:settings.quote_counter??1,
            job_prefix:settings.job_prefix||'J-',
            job_counter:settings.job_counter??1,
            invoice_prefix:settings.invoice_prefix||'INV-',
            invoice_counter:settings.invoice_counter??1
          });

          // Per-trigger webhooks
          w.reset({
            webhook_quote_created_enabled: !!settings.webhook_quote_created_enabled,
            webhook_quote_created_url: settings.webhook_quote_created_url || '',
            webhook_quote_created_secret: settings.webhook_quote_created_secret || '',

            webhook_quote_to_job_enabled: !!settings.webhook_quote_to_job_enabled,
            webhook_quote_to_job_url: settings.webhook_quote_to_job_url || '',
            webhook_quote_to_job_secret: settings.webhook_quote_to_job_secret || '',

            webhook_job_completed_enabled: !!settings.webhook_job_completed_enabled,
            webhook_job_completed_url: settings.webhook_job_completed_url || '',
            webhook_job_completed_secret: settings.webhook_job_completed_secret || '',

            webhook_invoice_generated_enabled: !!settings.webhook_invoice_generated_enabled,
            webhook_invoice_generated_url: settings.webhook_invoice_generated_url || '',
            webhook_invoice_generated_secret: settings.webhook_invoice_generated_secret || '',

            webhook_low_ink_enabled: !!settings.webhook_low_ink_enabled,
            webhook_low_ink_url: settings.webhook_low_ink_url || '',
            webhook_low_ink_secret: settings.webhook_low_ink_secret || '',

            webhook_low_materials_enabled: !!settings.webhook_low_materials_enabled,
            webhook_low_materials_url: settings.webhook_low_materials_url || '',
            webhook_low_materials_secret: settings.webhook_low_materials_secret || '',
          });
        }

        setVendorTypes(vtypes||[]);
        setMaterialTypes(mtypes||[]);
      }catch(e){
        console.error(e);
      }finally{
        setLoading(false);
      }
    };
    load();
  },[tenantId]);

  /** Save handlers — keep your existing ones, add webhooks save */
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

  const saveWebhooks=w.handleSubmit(async (vals)=>{
    const payload={ tenant_id:tenantId, ...vals };
    const {error}=await supabase.from('settings').update(payload).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.success('Webhooks saved');
  });

  // Types helpers (unchanged)
  const addVendorType=async ()=>{
    const name=newVendorType.trim(); if(!name) return;
    const r=await addType(tenantId,'vendor',name);
    setVendorTypes((xs)=>[...xs,r]); setNewVendorType(''); toast.success('Vendor type added');
  };
  const delVendorType=async (id)=>{
    await deleteType(tenantId,id);
    setVendorTypes((xs)=>xs.filter((x)=>x.id!==id)); toast.info('Deleted');
  };

  const addMaterialType=async ()=>{
    const name=newMaterialType.trim(); if(!name) return;
    const r=await addType(tenantId,'material',name);
    setMaterialTypes((xs)=>[...xs,r]); setNewMaterialType(''); toast.success('Material type added');
  };
  const delMaterialType=async (id)=>{
    await deleteType(tenantId,id);
    setMaterialTypes((xs)=>xs.filter((x)=>x.id!==id)); toast.info('Deleted');
  };

  /* =================== Data & Exports helpers =================== */

  const downloadCsv = (filename, rows) => {
    if(!rows || rows.length===0){ toast.info('Nothing to export'); return; }
    const esc = (v) => {
      if (v==null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => esc(r[h])).join(','))
    ].join('\n');

    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportInvoices = async ()=>{
    try{
      if(!tenantId) return;
      const {data:inv, error} = await supabase
        .from('invoices')
        .select('id, code, created_at, customer_id, job_id, totals, discount_type, discount_value, discount_apply_tax, deposit_amount')
        .eq('tenant_id', tenantId)
        .order('created_at', {ascending:false});
      if(error) throw error;

      // build customer map
      const {data:customers} = await supabase
        .from('customers')
        .select('id, name, company')
        .eq('tenant_id', tenantId);
      const cMap = new Map((customers||[]).map(c => [c.id, c]));

      const rows = (inv||[]).map(r=>{
        const totals = r.totals||{};
        const subtotal = Number(totals.totalCharge||0);  // pre-tax
        const tax = Number(totals.tax||0);
        const afterTax = Number(totals.totalAfterTax ?? totals.grand ?? (subtotal + tax));

        // discount calc
        let discount = 0;
        if (r.discount_type === 'percent') {
          const base = (r.discount_apply_tax ? afterTax : subtotal);
          discount = (Number(r.discount_value||0) / 100) * base;
        } else if (r.discount_type === 'flat') {
          discount = Number(r.discount_value||0);
        }

        const deposit = Number(r.deposit_amount||0);
        const total = afterTax - discount; // reported total; deposit is separate column

        const cust = cMap.get(r.customer_id);
        const customerName = cust ? (cust.company ? `${cust.company} — ${cust.name}` : cust.name) : '';

        return {
          'Invoice #': r.code,
          'Date': r.created_at ? new Date(r.created_at).toLocaleString() : '',
          'Customer': customerName,
          'Job #': r.job_id || '',
          'Subtotal': subtotal.toFixed(2),
          'Tax': tax.toFixed(2),
          'Discount': discount.toFixed(2),
          'Deposit': deposit.toFixed(2),
          'Total': total.toFixed(2)
        };
      });

      downloadCsv('invoices.csv', rows);
    }catch(e){
      console.error(e);
      toast.error(e.message||'Export failed');
    }
  };

  const exportCustomers = async ()=>{
    try{
      if(!tenantId) return;
      const {data, error} = await supabase
        .from('customers')
        .select('name, company, email, phone')
        .eq('tenant_id', tenantId)
        .order('name', {ascending:true});
      if(error) throw error;

      const rows = (data||[]).map(c => ({
        'Name': c.name||'',
        'Company': c.company||'',
        'Email': c.email||'',
        'Phone': c.phone||''
      }));

      downloadCsv('customers.csv', rows);
    }catch(e){
      console.error(e);
      toast.error(e.message||'Export failed');
    }
  };

  const exportVendors = async ()=>{
    try{
      if(!tenantId) return;
      const {data, error} = await supabase
        .from('vendors')
        .select('name, email, phone')
        .eq('tenant_id', tenantId)
        .order('name', {ascending:true});
      if(error) throw error;

      const rows = (data||[]).map(v => ({
        'Name': v.name||'',
        'Email': v.email||'',
        'Phone': v.phone||''
      }));

      downloadCsv('vendors.csv', rows);
    }catch(e){
      console.error(e);
      toast.error(e.message||'Export failed');
    }
  };

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

      {/* Webhooks – per-trigger */}
      <div className="card" style={{marginBottom:16}}>
        <h3>Webhooks</h3>
        <p className="tiny" style={{marginTop:6}}>Set a separate endpoint/secret per event. Only enabled rows will fire.</p>

        <form onSubmit={w.handleSubmit(saveWebhooks)} style={{marginTop:8}}>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:160}}>Event</th>
                <th>Endpoint URL</th>
                <th style={{width:260}}>Secret (optional)</th>
                <th style={{width:120}}>Enabled</th>
              </tr>
            </thead>
            <tbody>
              <Row eventLabel="Quote Created"
                   urlReg="webhook_quote_created_url"
                   secReg="webhook_quote_created_secret"
                   enReg="webhook_quote_created_enabled"
                   w={w}/>
              <Row eventLabel="Quote → Job"
                   urlReg="webhook_quote_to_job_url"
                   secReg="webhook_quote_to_job_secret"
                   enReg="webhook_quote_to_job_enabled"
                   w={w}/>
              <Row eventLabel="Job Completed"
                   urlReg="webhook_job_completed_url"
                   secReg="webhook_job_completed_secret"
                   enReg="webhook_job_completed_enabled"
                   w={w}/>
              <Row eventLabel="Invoice Generated"
                   urlReg="webhook_invoice_generated_url"
                   secReg="webhook_invoice_generated_secret"
                   enReg="webhook_invoice_generated_enabled"
                   w={w}/>
              <Row eventLabel="Low Ink"
                   urlReg="webhook_low_ink_url"
                   secReg="webhook_low_ink_secret"
                   enReg="webhook_low_ink_enabled"
                   w={w}/>
              <Row eventLabel="Low Materials"
                   urlReg="webhook_low_materials_url"
                   secReg="webhook_low_materials_secret"
                   enReg="webhook_low_materials_enabled"
                   w={w}/>
            </tbody>
          </table>

          <div className="row" style={{justifyContent:'flex-end', marginTop:10}}>
            <button className="btn btn-primary">Save Webhooks</button>
          </div>
        </form>
      </div>

      {/* Data & Exports */}
      <div className="card">
        <h3>Data & Exports</h3>
        <p className="tiny" style={{marginTop:6}}>Export your data as CSV files.</p>
        <div className="btn-row" style={{marginTop:8}}>
          <button className="btn" onClick={exportInvoices}><i className="fa-regular fa-file-lines"/> Export Invoices (CSV)</button>
          <button className="btn" onClick={exportCustomers}><i className="fa-regular fa-address-book"/> Export Customers (CSV)</button>
          <button className="btn" onClick={exportVendors}><i className="fa-regular fa-building"/> Export Vendors (CSV)</button>
        </div>
      </div>
    </section>
  );
}

/** Small row helper to keep your UI style */
function Row({eventLabel, urlReg, secReg, enReg, w}){
  return (
    <tr>
      <td>{eventLabel}</td>
      <td><input placeholder="https://example.com/webhook" {...w.register(urlReg)} /></td>
      <td><input placeholder="optional secret" {...w.register(secReg)} /></td>
      <td style={{textAlign:'center'}}>
        <input type="checkbox" {...w.register(enReg)} />
      </td>
    </tr>
  );
}
