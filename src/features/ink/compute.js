// src/features/ink/compute.js
// Minimal totals calculator used by older code paths.
// If you have a richer '../sales/calc.js', you can keep exporting from there instead.

export function computeTotals({materials, matLines, eqLines, addonLines, laborLines, marginPct}){
  const matById = new Map((materials||[]).map(m=>[m.id, m]));

  let matCost=0, matCharge=0;
  for(const l of (matLines||[])){
    const m = matById.get(l.material_id);
    if(!m) continue;
    const qty = Number(l.qty||0);
    matCost   += Number(m.purchase_price||0) * qty;
    matCharge += Number(m.selling_price||0) * qty;
  }

  // equipment charge: ignore UV here (ink handled separately)
  const UV_TYPES = new Set(["UV Printer","Sublimation Printer"]);
  let eqCharge=0;
  for(const l of (eqLines||[])){
    if(UV_TYPES.has(l.type)) continue;
    if(l.mode==="hourly") eqCharge += Number(l.hours||0) * Number(l.rate||0);
    else eqCharge += Number(l.flat_fee||0);
  }

  let laborCharge=0;
  for(const l of (laborLines||[])) laborCharge += Number(l.hours||0) * Number(l.rate||0);

  let addonCharge=0;
  for(const l of (addonLines||[])) addonCharge += Number(l.qty||0) * Number(l.price||0);

  const inkCost = 0;
  const inkCharge = inkCost * (1 + Number(marginPct||0)/100);

  const totalCost   = matCost + inkCost;
  const totalCharge = matCharge + inkCharge + eqCharge + laborCharge + addonCharge;
  const taxPct = 0, tax = 0;
  const grand = totalCharge + tax;
  const profit = totalCharge - totalCost;
  const profitPct = totalCost>0 ? (profit/totalCost)*100 : 0;

  return {matCost, matCharge, eqCharge, laborCharge, addonCharge, inkCost, inkCharge, totalCost, totalCharge, taxPct, tax, grand, profit, profitPct};
}
