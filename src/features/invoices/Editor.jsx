import {useEffect, useMemo, useState} from 'react';
import {supabase} from '../../lib/superbase.js';
import {useTenant} from '../../context/TenantContext.jsx';
import {computeInvoiceTotals} from './totals.js';

export default function InvoiceEditor({invoiceId, onClose}){
  const {tenantId}=useTenant();
  const [row,setRow]=useState(null);
  const [settings,setSettings]=useState(null);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  useEffect(()=>{
    const load=async ()=>{
      setLoading(true);
      const [{data:inv},{data:st}] = await Promise.all([
        supabase.from('invoices').select('*').eq('id', invoiceId).eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('settings').select('*').eq('tenant_id', tenantId).maybeSingle()
      ]);
      setRow(inv||null); setSettings(st||null); setLoading(false);
    };
    if(invoiceId && tenantId){load();}
  },[invoiceId, tenantId]);

  const totals=useMemo(()=>{
    if(!row){return null;}
    return computeInvoiceTotals({
      baseTotals: row.totals||{},
      taxRate: row.tax_rate ?? settings?.tax_rate ?? 0,
      discountType: row.discount_type,
      discountValue: row.discount_value,
      applyTaxToDiscount: row.apply_tax_to_discount,
      deposit: row.deposit
    });
  },[row, settings?.tax_rate]);

  const save=async ()=>{
    setSaving(true);
    const patch={
      discount_type: row.discount_type||'flat',
      discount_value: Number(row.discount_value||0),
      apply_tax_to_discount: !!row.apply_tax_to_discount,
      deposit: Number(row.deposit||0),
      memo: row.memo||'',
      tax_rate: Number(row.tax_rate ?? settings?.tax_rate ?? 0),
      totals: {...(row.totals||{}), totalDue: totals?.totalDue, grandTotal: totals?.total}
    };
    const {error}=await supabase.from('invoices').update(patch).eq('id', row.id).eq('tenant_id', tenantId);
    setSaving(false);
    if(error){ alert(error.message); return; }
    alert('Invoice saved.');
    onClose?.();
  };

  if(loading) return <div className="tiny">Loading…</div>;
  if(!row) return <div className="tiny">Invoice not found</div>;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-content wide" onClick={(e)=>e.stopPropagation()}>
        <h3>Edit Invoice <span className="tiny mono" style={{marginLeft:8}}>{row.code}</span></h3>

        <div className="grid-3">
          <div className="group">
            <label>Discount Type</label>
            <select value={row.discount_type||'flat'} onChange={(e)=>setRow({...row, discount_type:e.target.value})}>
              <option value="flat">Flat</option>
              <option value="percent">Percent</option>
            </select>
          </div>
          <div className="group">
            <label>Discount Value</label>
            <input type="number" value={row.discount_value||0} step="0.01" onChange={(e)=>setRow({...row, discount_value:e.target.value})}/>
          </div>
          <div className="group">
            <label>Apply Tax To Discount</label>
            <select value={row.apply_tax_to_discount?'yes':'no'} onChange={(e)=>setRow({...row, apply_tax_to_discount: e.target.value==='yes'})}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>

          <div className="group">
            <label>Tax Rate %</label>
            <input type="number" step="0.01" value={row.tax_rate ?? settings?.tax_rate ?? 0}
                   onChange={(e)=>setRow({...row, tax_rate:e.target.value})}/>
          </div>
          <div className="group">
            <label>Deposit</label>
            <input type="number" step="0.01" value={row.deposit||0} onChange={(e)=>setRow({...row, deposit:e.target.value})}/>
          </div>
          <div className="group" style={{gridColumn:'1 / -1'}}>
            <label>Memo</label>
            <textarea rows={3} value={row.memo||''} onChange={(e)=>setRow({...row, memo:e.target.value})}/>
          </div>
        </div>

        {totals?(
          <div className="card" style={{marginTop:10}}>
            <div className="row"><span>Pre-tax:</span><b>${totals.preTax}</b></div>
            <div className="row"><span>Discount:</span><b>-${totals.discount}</b></div>
            <div className="row"><span>Taxable:</span><b>${totals.taxable}</b></div>
            <div className="row"><span>Tax:</span><b>${totals.tax}</b></div>
            <div className="row"><span>Total:</span><b>${totals.total}</b></div>
            <div className="row"><span>Deposit:</span><b>-${row.deposit||0}</b></div>
            <div className="row"><span>Amount Due:</span><b>${totals.totalDue}</b></div>
          </div>
        ):null}

        <div className="btn-row" style={{marginTop:12}}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
