// Central totals engine used by Quotes/Jobs (and referenced by Invoices).
// Applies margin only to ink cost; materials use selling_price; labor/addons sum straight.
// Returns a normalized set of rounded totals.

const round=(n,dp=2)=>Number((+n||0).toFixed(dp));
const safeN=(v)=>Number(v||0);

export function computeTotals({settings, equipmentsById={}, form}){
  const taxPct=safeN(settings?.tax_rate);

  // ---- Ink (raw cost, then margin-applied charge) ----
  const inkCostRaw=(form?.items?.equipments||[]).reduce((sum,row)=>{
    const eq=equipmentsById[row.equipment_id]||{};
    const rates=eq.ink_rates||{}; // {c,m,y,k,white,soft_white,gloss}
    const parts=['c','m','y','k','gloss'];
    let cost=0;
    for(const p of parts){ cost += safeN(row[p])*safeN(rates[p]); }
    if(eq.use_soft_white){ cost += safeN(row.soft_white)*safeN(rates.soft_white); }
    else{ cost += safeN(row.white)*safeN(rates.white); }
    return sum + cost;
  },0);

  const marginPct=safeN(form?.marginPct);
  const inkCharge=inkCostRaw*(1+marginPct/100);

  // ---- Materials ----
  const matCost=(form?.items?.materials||[]).reduce((s,m)=>s + safeN(m.purchase_price)*safeN(m.qty), 0);
  const matCharge=(form?.items?.materials||[]).reduce((s,m)=>s + safeN(m.selling_price)*safeN(m.qty), 0);

  // ---- Labor ----
  const laborCharge=(form?.items?.labor||[]).reduce((s,l)=>s + safeN(l.hours)*safeN(l.rate), 0);

  // ---- Add-ons ----
  const addonCharge=(form?.items?.addons||[]).reduce((s,a)=>s + safeN(a.qty)*safeN(a.price), 0);

  const totalCost = inkCostRaw + matCost;
  const totalChargePreTax = inkCharge + matCharge + laborCharge + addonCharge;
  const tax = totalChargePreTax*(taxPct/100);
  const totalAfterTax = totalChargePreTax + tax;
  const profit = totalChargePreTax - totalCost;
  const profitPct = totalCost>0 ? (profit/totalCost)*100 : 0;

  return {
    inkCostRaw: round(inkCostRaw),
    inkCharge: round(inkCharge),
    matCost: round(matCost),
    matCharge: round(matCharge),
    laborCharge: round(laborCharge),
    addonCharge: round(addonCharge),
    totalCost: round(totalCost),
    totalChargePreTax: round(totalChargePreTax),
    tax: round(tax),
    totalAfterTax: round(totalAfterTax),
    profit: round(profit),
    profitPct: round(profitPct,2)
  };
}
