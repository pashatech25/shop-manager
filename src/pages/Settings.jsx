// src/pages/Settings.jsx
import {useEffect, useState, useMemo} from 'react';
import {useForm} from 'react-hook-form';
import {z} from 'zod';
import {zodResolver} from '@hookform/resolvers/zod';
import {toast} from 'react-toastify';
import {supabase} from '../lib/superbase.js';
import {useTenant} from '../context/TenantContext.jsx';
import {listTypes, addType, deleteType} from '../features/types/api.js';
import BrandingUpload from '../features/settings/BrandingUpload.jsx';

// NEW: drag-and-drop designer
import TemplateDesigner from '../features/email/TemplateDesigner.jsx';

// templates
import {
  renderTemplate,
  invoiceDefaults,
  poDefaults,
  buildInvoiceContext,
  buildPOContext
} from '../features/email/templates.js';

/** ----- Schemas (match existing UI) ----- */
const financeSchema=z.object({
  business_name:z.string().min(1,'Required'),
  business_email:z.string().email('Invalid email').optional().or(z.literal('')),
  business_phone:z.string().optional().or(z.literal('')),
  business_address:z.string().optional().or(z.literal('')),
  tax_rate:z.coerce.number().min(0).max(100),
  currency:z.string().min(1),
  brand_primary:z.string().optional().or(z.literal('')),
  brand_secondary:z.string().optional().or(z.literal('')),
  brand_logo_path:z.string().optional().or(z.literal('')),
  brand_logo_url:z.string().optional().or(z.literal(''))
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
  webhook_quote_created_enabled: z.coerce.boolean().default(false),
  webhook_quote_created_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_quote_created_secret: z.string().optional().or(z.literal('')),

  webhook_quote_to_job_enabled: z.coerce.boolean().default(false),
  webhook_quote_to_job_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_quote_to_job_secret: z.string().optional().or(z.literal('')),

  webhook_job_completed_enabled: z.coerce.boolean().default(false),
  webhook_job_completed_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_job_completed_secret: z.string().optional().or(z.literal('')),

  webhook_invoice_generated_enabled: z.coerce.boolean().default(false),
  webhook_invoice_generated_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_invoice_generated_secret: z.string().optional().or(z.literal('')),

  webhook_low_ink_enabled: z.coerce.boolean().default(false),
  webhook_low_ink_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_low_ink_secret: z.string().optional().or(z.literal('')),

  webhook_low_materials_enabled: z.coerce.boolean().default(false),
  webhook_low_materials_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  webhook_low_materials_secret: z.string().optional().or(z.literal('')),
});

/** Email templates schema */
const emailSchema=z.object({
  email_invoice_subject: z.string().optional().or(z.literal('')),
  email_invoice_template_html: z.string().optional().or(z.literal('')),
  email_po_subject: z.string().optional().or(z.literal('')),
  email_po_template_html: z.string().optional().or(z.literal('')),
  // (logo is in finance; we just use it in previews)
});

export default function Settings(){
  const {tenantId}=useTenant();
  const [loading,setLoading]=useState(true);
  const [row,setRow]=useState(null);
  const [activeTab, setActiveTab] = useState('branding');

  // NEW: modal controls for designer
  const [designerOpen, setDesignerOpen] = useState(false);
  const [designerType, setDesignerType] = useState('invoice'); // 'invoice' | 'po'

  // Forms: Branding/Finance
  const f=useForm({
    resolver:zodResolver(financeSchema),
    defaultValues:{
      business_name:'', business_email:'', business_phone:'', business_address:'',
      tax_rate:0, currency:'USD',
      brand_primary:'#111111', brand_secondary:'#007bff',
      brand_logo_path:'', brand_logo_url:''
    }
  });

  // Numbering
  const n=useForm({
    resolver:zodResolver(numberingSchema),
    defaultValues:{quote_prefix:'Q-', quote_counter:1, job_prefix:'J-', job_counter:1, invoice_prefix:'INV-', invoice_counter:1}
  });

  // Webhooks (per-trigger)
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

  // Email templates
  const e=useForm({
    resolver:zodResolver(emailSchema),
    defaultValues:{
      email_invoice_subject: '',
      email_invoice_template_html: '',
      email_po_subject: '',
      email_po_template_html: ''
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
            brand_logo_path:settings.brand_logo_path||'',
            brand_logo_url:settings.brand_logo_url||''
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

          // Webhooks
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

          // Email templates
          e.reset({
            email_invoice_subject: settings.email_invoice_subject || '',
            email_invoice_template_html: settings.email_invoice_template_html || '',
            email_po_subject: settings.email_po_subject || '',
            email_po_template_html: settings.email_po_template_html || ''
          });
        }

        setVendorTypes(vtypes||[]);
        setMaterialTypes(mtypes||[]);
      }catch(ex){
        console.error(ex);
      }finally{
        setLoading(false);
      }
    };
    load();
  },[tenantId]);

  /** Save handlers */
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

  const saveEmails=e.handleSubmit(async (vals)=>{
    const payload={ tenant_id:tenantId, ...vals };
    const {error}=await supabase.from('settings').update(payload).eq('tenant_id', tenantId);
    if(error){ toast.error(error.message); return; }
    toast.success('Email templates saved');
  });

  // Types helpers
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

  async function exportInvoices(){
    try{
      const { data, error } = await supabase
        .from("invoice_export_v")
        .select("*")
        .eq("tenant_id", tenantId);
      if(error) throw error;

      const rows = [];
      rows.push([
        "Invoice #",
        "Date",
        "Customer",
        "Job #",
        "Total (pre-tax)",
        "Tax",
        "Discount",
        "Deposit",
        "Final Total"
      ]);

      for(const r of (data || [])){
        rows.push([
          r.invoice_code || "",
          r.invoice_created_at ? new Date(r.invoice_created_at).toLocaleString() : "",
          r.customer_name || "",
          r.job_code || "",
          Number(r.total_pre_tax || 0).toFixed(2),
          Number(r.tax_amount    || 0).toFixed(2),
          Number(r.discount_amount || 0).toFixed(2),
          Number(r.deposit_amount  || 0).toFixed(2),
          Number(r.final_total     || 0).toFixed(2),
        ]);
      }

      const csv = rows.map(r => r.map(cell => {
        const s = String(cell ?? "");
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(",")).join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `invoices_export_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }catch(e){
      console.error(e);
      alert(e.message || "Failed to export invoices.");
    }
  }

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

  // Tab configuration (kept your styling)
  const tabs = [
    { id: 'branding', label: 'Branding' },
    { id: 'numbering', label: 'Numbering' },
    { id: 'types', label: 'Custom Types' },
    { id: 'webhooks', label: 'Webhooks' },
    { id: 'exports', label: 'Data & Exports' },
    { id: 'email', label: 'Email Templates' }
  ];

  // ---------- Email Preview helpers ----------
  const invoicePreview = useMemo(()=>{
    const dft = invoiceDefaults();
    const subj = e.watch('email_invoice_subject') || dft.subject;
    const body = e.watch('email_invoice_template_html') || dft.html;

    const settings = {
      business_name: f.getValues('business_name'),
      business_email: f.getValues('business_email'),
      brand_logo_url: f.getValues('brand_logo_url'),
      brand_logo_path: f.getValues('brand_logo_path')
    };
    const ctx = buildInvoiceContext({
      invoice: { code:'INV-123', created_at:new Date().toISOString() },
      customer: { name:'John Doe', company:'Acme', email:'john@example.com' },
      settings,
      money: { subtotal: 500, tax: 50, discount: 25, deposit: 0, grand: 525 },
      pdfUrl: 'https://example.com/invoice.pdf'
    });
    return {
      subject: renderTemplate(subj, ctx),
      html: renderTemplate(body, ctx)
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.watch('email_invoice_subject'), e.watch('email_invoice_template_html'),
      f.watch('business_name'), f.watch('business_email'), f.watch('brand_logo_url'), f.watch('brand_logo_path')]);

  const poPreview = useMemo(()=>{
    const dft = poDefaults();
    const subj = e.watch('email_po_subject') || dft.subject;
    const body = e.watch('email_po_template_html') || dft.html;

    const settings = {
      business_name: f.getValues('business_name'),
      business_email: f.getValues('business_email'),
      brand_logo_url: f.getValues('brand_logo_url'),
      brand_logo_path: f.getValues('brand_logo_path')
    };
    const ctx = buildPOContext({
      po: { code:'PO-456', created_at:new Date().toISOString(), items_count:3 },
      vendor: { name:'Vendor Inc.', email:'vendor@example.com' },
      settings,
      pdfUrl: 'https://example.com/po.pdf'
    });
    return {
      subject: renderTemplate(subj, ctx),
      html: renderTemplate(body, ctx)
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.watch('email_po_subject'), e.watch('email_po_template_html'),
      f.watch('business_name'), f.watch('business_email'), f.watch('brand_logo_url'), f.watch('brand_logo_path')]);

  const resetInvToDefault = ()=>{
    const d = invoiceDefaults();
    e.setValue('email_invoice_subject', d.subject);
    e.setValue('email_invoice_template_html', d.html);
  };
  const resetPOToDefault = ()=>{
    const d = poDefaults();
    e.setValue('email_po_subject', d.subject);
    e.setValue('email_po_template_html', d.html);
  };

  // small helper to open designer preloaded with current editor values
  function openDesigner(which){
    setDesignerType(which); // 'invoice' or 'po'
    setDesignerOpen(true);
  }

  return (
    <section className="section">
      <div className="section-header">
        <h2>Settings</h2>
        {loading ? <span className="tiny">Loading…</span> : null}
      </div>

      {/* Tab Navigation (kept your styling) */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', marginBottom: '24px', gap: '4px',
        padding: '4px', backgroundColor: '#f1f3f4', borderRadius: '12px', width: '100%', boxSizing: 'border-box'
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 12px', border: 'none', borderRadius: '8px',
              backgroundColor: activeTab === tab.id ? '#ffffff' : 'transparent',
              color: activeTab === tab.id ? '#1d1d1f' : '#6e6e73',
              cursor: 'pointer', fontSize: '13px',
              fontWeight: activeTab === tab.id ? '600' : '400',
              transition: 'all .2s cubic-bezier(0.25,0.46,0.45,0.94)',
              boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)' : 'none',
              flex: '1 1 auto', minWidth: 0, textAlign: 'center',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Branding */}
      {activeTab === 'branding' && (
        <div className="card">
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
              <div className="tiny" style={{marginTop:6}}>Or external logo URL:</div>
              <input placeholder="https://…" {...f.register('brand_logo_url')}/>
            </div>

            <div className="group"><label>Tax Rate %</label><input type="number" step="0.01" {...f.register('tax_rate')}/></div>
            <div className="group"><label>Currency</label><input {...f.register('currency')}/></div>

            <div style={{gridColumn:'1 / -1'}}><button className="btn btn-primary">Save Branding & Finance</button></div>
          </form>
        </div>
      )}

      {/* Numbering */}
      {activeTab === 'numbering' && (
        <div className="card">
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
      )}

      {/* Custom Types */}
      {activeTab === 'types' && (
        <div className="card">
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
      )}

      {/* Webhooks */}
      {activeTab === 'webhooks' && (
        <div className="card">
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
                <Row eventLabel="Quote Created" urlReg="webhook_quote_created_url" secReg="webhook_quote_created_secret" enReg="webhook_quote_created_enabled" w={w}/>
                <Row eventLabel="Quote → Job" urlReg="webhook_quote_to_job_url" secReg="webhook_quote_to_job_secret" enReg="webhook_quote_to_job_enabled" w={w}/>
                <Row eventLabel="Job Completed" urlReg="webhook_job_completed_url" secReg="webhook_job_completed_secret" enReg="webhook_job_completed_enabled" w={w}/>
                <Row eventLabel="Invoice Generated" urlReg="webhook_invoice_generated_url" secReg="webhook_invoice_generated_secret" enReg="webhook_invoice_generated_enabled" w={w}/>
                <Row eventLabel="Low Ink" urlReg="webhook_low_ink_url" secReg="webhook_low_ink_secret" enReg="webhook_low_ink_enabled" w={w}/>
                <Row eventLabel="Low Materials" urlReg="webhook_low_materials_url" secReg="webhook_low_materials_secret" enReg="webhook_low_materials_enabled" w={w}/>
              </tbody>
            </table>

            <div className="btn-row" style={{justifyContent:'flex-end', marginTop:12}}>
              <button className="btn btn-primary">Save Webhooks</button>
            </div>
          </form>
        </div>
      )}

      {/* Data & Exports */}
      {activeTab === 'exports' && (
        <div className="card">
          <h3>Data & Exports</h3>
          <div className="row" style={{marginTop:8, gap:8}}>
            <button className="btn" onClick={exportInvoices}>Export Invoices CSV</button>
            <button className="btn" onClick={exportCustomers}>Export Customers CSV</button>
            <button className="btn" onClick={exportVendors}>Export Vendors CSV</button>
          </div>
        </div>
      )}

      {/* Email Templates */}
      {activeTab === 'email' && (
        <div className="card">
          <h3>Email Templates</h3>
          <form onSubmit={e.handleSubmit(saveEmails)} style={{marginTop:8}}>
            <div className="grid-2">
              {/* Invoice template */}
              <div>
                <div className="group">
                  <label className="tiny">Invoice Subject</label>
                  <input placeholder="Invoice {{invoice.code}} from {{business.name}}" {...e.register('email_invoice_subject')}/>
                </div>
                <div className="group">
                  <label className="tiny">Invoice HTML</label>
                  <textarea rows={14} placeholder="HTML with {{tags}}" {...e.register('email_invoice_template_html')}/>
                </div>
                <div className="btn-row">
                  <button className="btn" type="button" onClick={resetInvToDefault}>Reset to default</button>
                  {/* NEW: open designer for invoice */}
                  <button type="button" className="btn btn-primary" onClick={()=>openDesigner('invoice')}>
                    Open Designer
                  </button>
                </div>
              </div>

              {/* Invoice live preview */}
              <div>
                <div className="group">
                  <label className="tiny">Invoice Preview — Subject</label>
                  <input readOnly value={invoicePreview.subject}/>
                </div>
                <div className="group">
                  <label className="tiny">Invoice Preview — Body</label>
                  <div style={{border:'1px solid #eee', borderRadius:8, padding:10, background:'#fafafa', maxHeight:360, overflow:'auto'}}
                       dangerouslySetInnerHTML={{__html: invoicePreview.html}}/>
                </div>
              </div>
            </div>

            <div className="grid-2" style={{marginTop:18}}>
              {/* PO template */}
              <div>
                <div className="group">
                  <label className="tiny">PO Subject</label>
                  <input placeholder="Purchase Order {{po.code}} from {{business.name}}" {...e.register('email_po_subject')}/>
                </div>
                <div className="group">
                  <label className="tiny">PO HTML</label>
                  <textarea rows={14} placeholder="HTML with {{tags}}" {...e.register('email_po_template_html')}/>
                </div>
                <div className="btn-row">
                  <button className="btn" type="button" onClick={resetPOToDefault}>Reset to default</button>
                  {/* NEW: open designer for PO */}
                  <button type="button" className="btn btn-primary" onClick={()=>openDesigner('po')}>
                    Open Designer
                  </button>
                </div>
              </div>

              {/* PO live preview */}
              <div>
                <div className="group">
                  <label className="tiny">PO Preview — Subject</label>
                  <input readOnly value={poPreview.subject}/>
                </div>
                <div className="group">
                  <label className="tiny">PO Preview — Body</label>
                  <div style={{border:'1px solid #eee', borderRadius:8, padding:10, background:'#fafafa', maxHeight:360, overflow:'auto'}}
                       dangerouslySetInnerHTML={{__html: poPreview.html}}/>
                </div>
              </div>
            </div>

            <div className="btn-row" style={{justifyContent:'flex-end', marginTop:12}}>
              <button className="btn btn-primary">Save Email Templates</button>
            </div>
          </form>

          <div className="tiny" style={{marginTop:10}}>
            Available tags include: <code>{'{{business.name}} {{business.email}} {{business.logo_url}} {{date}} {{pdf_url}} {{invoice.code}} {{customer.name}} {{money.subtotal}} {{money.tax}} {{money.discount}} {{money.deposit}} {{money.grand}} {{po.code}} {{po.items_count}} {{vendor.name}}'}</code>
          </div>
        </div>
      )}

      {/* NEW: Designer modal (small, reuses your modal classes) */}
      {designerOpen && (
        <div className="modal" onClick={()=>setDesignerOpen(false)}>
          <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
            <div className="row">
              <h3>Template Designer — {designerType === 'invoice' ? 'Invoice' : 'Purchase Order'}</h3>
              <button className="btn btn-secondary" onClick={()=>setDesignerOpen(false)}>Close</button>
            </div>

            <TemplateDesigner
              tenantId={tenantId}
              type={designerType}
              initialHtml={
                designerType==='invoice'
                  ? e.getValues('email_invoice_template_html')
                  : e.getValues('email_po_template_html')
              }
              defaultHtml={
                designerType==='invoice'
                  ? invoiceDefaults().html
                  : poDefaults().html
              }
              variables={[
                { name:'business.name',  sample: f.getValues('business_name') || 'Your Business' },
                { name:'business.email', sample: f.getValues('business_email') || 'hello@example.com' },
                { name:'assets.logo_url', sample: f.getValues('brand_logo_url') || '' },
                { name:'assets.logo_url_display', sample: (f.getValues('brand_logo_url') ? 'block' : 'none') },
                // common
                { name:'date', sample: new Date().toLocaleDateString() },
                { name:'links.pdf_url', sample: 'https://example.com/file.pdf' },
                // invoice-specific
                { name:'invoice.code', sample: 'INV-123' },
                { name:'customer.name', sample: 'John Doe' },
                { name:'money.subtotal', sample: '$500.00' },
                { name:'money.tax', sample: '$65.00' },
                { name:'money.discount', sample: '$25.00' },
                { name:'money.deposit', sample: '$0.00' },
                { name:'money.grand', sample: '$540.00' },
                // po-specific
                { name:'po.code', sample:'PO-456' },
                { name:'po.items_count', sample:'3' },
                { name:'vendor.name', sample:'Vendor Inc.' },
              ]}
              onSaved={(html)=>{
                if (designerType==='invoice') {
                  e.setValue('email_invoice_template_html', html, { shouldDirty:true });
                } else {
                  e.setValue('email_po_template_html', html, { shouldDirty:true });
                }
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Row({eventLabel, urlReg, secReg, enReg, w}){
  return (
    <tr>
      <td>{eventLabel}</td>
      <td><input placeholder="https://your-webhook" {...w.register(urlReg)}/></td>
      <td><input placeholder="Optional secret" {...w.register(secReg)}/></td>
      <td style={{textAlign:'center'}}><input type="checkbox" {...w.register(enReg)}/></td>
    </tr>
  );
}
