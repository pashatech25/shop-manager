// Invoice totals derived from a job/quote totals snapshot plus invoice-only fields.
// Supports flat or percent discount; optional "apply tax to discount"; deposit.

const n=(v)=>Number(v||0);
const round=(v,dp=2)=>Number((+v||0).toFixed(dp));

export function computeInvoiceTotals({baseTotals, taxRate, discountType='flat', discountValue=0, applyTaxToDiscount=false, deposit=0}){
  // baseTotals.totalChargePreTax should exist; fallback to totalAfterTax if needed
  const preTax = n(baseTotals?.totalChargePreTax ?? 0);
  const taxPct = n(taxRate ?? baseTotals?.taxRate ?? 0);

  // discount
  let discount = 0;
  if(discountType==='percent'){ discount = preTax * (n(discountValue)/100); }
  else { discount = n(discountValue); }

  // taxable amount
  let taxable = preTax - discount;
  if(applyTaxToDiscount){ taxable = preTax; } // tax ignores discount (tax after discount off total)
  if(taxable < 0) taxable = 0;

  const tax = taxable * (taxPct/100);
  const total = (preTax - discount) + tax;
  const totalDue = total - n(deposit);

  return {
    preTax: round(preTax),
    discount: round(discount),
    taxable: round(taxable),
    tax: round(tax),
    total: round(total),
    totalDue: round(totalDue)
  };
}
