// api/_engine.js  —  UEDP v5 Business Pulse Engine
// Underscore prefix = Vercel ignores as HTTP route
// All api/*.js files copy this block inline (no cross-file require)
'use strict';

const OC = 1 / Math.E; // Ω_crit ≈ 0.36788

// ── Signal primitives ─────────────────────────────────────────────────────
function mean(x) { return x.length ? x.reduce((s,v)=>s+v,0)/x.length : 0; }
function variance(x) {
  if (x.length < 2) return 0;
  const m = mean(x);
  return x.reduce((s,v)=>s+(v-m)**2,0)/x.length;
}
function spikeIndex(x) {
  if (x.length < 2) return 0;
  const m = mean(x)||1;
  let mx = 0;
  for (let i=1;i<x.length;i++) mx = Math.max(mx, Math.abs(x[i]-x[i-1]));
  return mx/m;
}
function driftSlope(x) {
  if (x.length < 2) return 0;
  const n=x.length, sx=(n*(n-1))/2, sx2=((n-1)*n*(2*n-1))/6;
  const sy=x.reduce((s,v)=>s+v,0), sxy=x.reduce((s,v,i)=>s+i*v,0);
  const d=n*sx2-sx*sx; return d===0?0:(n*sxy-sx*sy)/d;
}
function clamp(v,lo=0,hi=1){ return Math.min(hi,Math.max(lo,v)); }

// ── Instability index (I_seq) ─────────────────────────────────────────────
function computeIseq(seq) {
  if (seq.length < 3) return 0;
  const dirs = [];
  for (let i=1;i<seq.length;i++) dirs.push(seq[i]>seq[i-1]?1:seq[i]<seq[i-1]?-1:0);
  let B=0, S=0;
  for (let i=1;i<dirs.length;i++){
    const cos=(dirs[i]===0||dirs[i-1]===0)?0:dirs[i]*dirs[i-1];
    B+=(1-cos);
    if(dirs[i]!==0&&dirs[i-1]!==0&&dirs[i]!==dirs[i-1])S++;
  }
  return Math.min(2, B/dirs.length + S/(S+1));
}

// ── Main UEDP engine ──────────────────────────────────────────────────────
function computeOmega(input) {
  const EP = 1e-9;
  const {
    hourlyProd=[], hourlyTargets=[],
    empPresent=0, empTotal=1,
    runningCost=0, fixedCost=0, capital=0,
    outputVol=0, outputValue=0, targetValue=0,
    ordersReceived=0, ordersConfirmed=0,
    timeToConfirmHrs=2, paymentLeadDays=30,
    salesLeads=0, salesClosed=0,
    mixItems=[],
    hoursElapsed=8,
  } = input;

  const totalCost = runningCost + fixedCost;

  // ── Sub-scores ──────────────────────────────────────────────────────────
  const attendance   = clamp(empPresent/(empTotal||1));
  const hv = hourlyProd.filter(v=>!isNaN(v)&&v>=0);
  const ht = hourlyTargets.filter(v=>!isNaN(v)&&v>0);
  const avgTarget    = ht.length ? mean(ht) : 0;
  const prodEff      = (hv.length && avgTarget>0) ? clamp(mean(hv)/avgTarget) : (hv.length ? 0.5 : 0.3);
  const revEff       = targetValue>0 ? clamp(outputValue/targetValue) : (totalCost>0 ? clamp(outputValue/totalCost) : 0.5);
  const confirmRate  = ordersReceived>0 ? clamp(ordersConfirmed/ordersReceived) : 1;
  const salesConvRate= salesLeads>0 ? clamp(salesClosed/salesLeads) : 1;

  // Direction vector magnitude [0..1]
  const dirVec = [attendance, prodEff, revEff];
  const dirMag = clamp(Math.sqrt(dirVec.reduce((s,v)=>s+v*v,0)/dirVec.length));

  // ── Feature normalisation ───────────────────────────────────────────────
  const normVar   = clamp(hv.length>=2 ? variance(hv)/(mean(hv)**2+EP) : 0, 0, 1);
  const normSpike = clamp(hv.length>=2 ? spikeIndex(hv)/3 : 0, 0, 1);
  const drift     = hv.length>=2 ? driftSlope(hv) : 0;
  const normDrift = clamp(Math.abs(drift)/((mean(hv)||1)+EP), 0, 1);
  const normDir   = clamp(1-dirMag, 0, 1);

  const margin    = totalCost>0 ? (outputValue-totalCost)/totalCost : 0;
  const normCost  = clamp(margin<0 ? 1 : Math.max(0,1-margin), 0, 1);

  const confirmPenalty = clamp(1-confirmRate*0.6-salesConvRate*0.4, 0, 1);
  const payPenalty     = clamp(paymentLeadDays>90?1:paymentLeadDays/90, 0, 1)*0.3;
  const normOrder = clamp(confirmPenalty*0.7 + payPenalty, 0, 1);

  // ── Omega ──────────────────────────────────────────────────────────────
  const W = {var:0.20, spike:0.15, drift:0.10, dir:0.20, cost:0.20, order:0.15};
  const penalty = W.var*normVar + W.spike*normSpike + W.drift*normDrift
                + W.dir*normDir + W.cost*normCost + W.order*normOrder;
  const mag = outputValue/(totalCost+EP);
  const psi = clamp(mag/(mag+1));
  const omega = clamp(psi * Math.exp(-penalty));

  // ── I_seq ──────────────────────────────────────────────────────────────
  const Iseq = computeIseq(hv);

  // ── RSL ────────────────────────────────────────────────────────────────
  const OmegaRef = 0.70;
  const tau  = OmegaRef - omega;
  const Rmag = Math.abs(tau)/(OmegaRef+EP);
  const Rmod = (tau>0 && omega<OC) ? -Rmag : Rmag;

  // ── Phi / Gamma / AT ───────────────────────────────────────────────────
  const dOmega  = Math.max(OC-omega, EP);
  const Icoh    = Math.max(0, 1-Iseq);
  const Phi     = (Icoh*Rmod)/dOmega;
  const ODebt   = Math.max(OC-omega, 0);
  const Gamma   = (ODebt*penalty+EP)/(Math.abs(Rmod)+EP);
  const Upsilon = Math.abs(Rmod);
  const AT      = (Upsilon*Math.abs(Phi))/(Iseq*Gamma+EP);
  const isAnados= AT>1;

  // ── P&L ────────────────────────────────────────────────────────────────
  const grossProfit = outputValue - runningCost;
  const netProfit   = outputValue - totalCost;
  const grossMargin = outputValue>0 ? grossProfit/outputValue*100 : 0;
  const netMargin   = outputValue>0 ? netProfit/outputValue*100 : 0;
  const capReturn   = capital>0 ? netProfit/capital*100 : null;
  const costPerUnit = outputVol>0 ? totalCost/outputVol : null;
  const revPerUnit  = outputVol>0 ? outputValue/outputVol : null;
  const ratePerHr   = hoursElapsed>0 ? outputVol/hoursElapsed : null;
  const projEOD     = ratePerHr ? ratePerHr*10 : null;
  const targetGap   = targetValue>0 ? targetValue-outputValue : null;
  const breakEven   = totalCost>0 ? totalCost : null;
  const willProfitable = netProfit>0;
  const projMargin  = (projEOD && costPerUnit && revPerUnit)
    ? (projEOD*revPerUnit - totalCost)/Math.max(projEOD*revPerUnit,EP)*100
    : null;

  // ── Sub-scores 0-100 ───────────────────────────────────────────────────
  const wfScore  = Math.round(clamp(attendance*0.5 + (1-normVar)*0.3 + (1-normSpike)*0.2)*100);
  const finScore = Math.round(clamp(revEff*0.5 + (1-normCost)*0.5)*100);
  const ordScore = Math.round(clamp(confirmRate*0.5 + salesConvRate*0.3 + (1-payPenalty/0.3)*0.2)*100);

  // ── Penalty breakdown for alerts ───────────────────────────────────────
  const penalties = [
    {key:'hourly_variance',   score:W.var*normVar,   raw:normVar,   label:'Hourly Productivity Variance'},
    {key:'spike',             score:W.spike*normSpike,raw:normSpike, label:'Sudden Hour-to-Hour Drops'},
    {key:'drift',             score:W.drift*normDrift,raw:normDrift, label:'Declining Productivity Trend'},
    {key:'direction',         score:W.dir*normDir,   raw:normDir,   label:'Workforce/Revenue Misalignment'},
    {key:'cost_overrun',      score:W.cost*normCost, raw:normCost,  label:'Cost vs Revenue Pressure'},
    {key:'order_pipeline',    score:W.order*normOrder,raw:normOrder, label:'Order/Sales Pipeline Health'},
  ].sort((a,b)=>b.score-a.score);

  return {
    omega: Math.round(omega*10000)/10000,
    Iseq:  Math.round(Iseq*10000)/10000,
    Rmod:  Math.round(Rmod*10000)/10000,
    Phi:   Math.round(Phi*10000)/10000,
    Gamma: Math.round(Gamma*10000)/10000,
    AT:    Math.round(AT*100)/100,
    isAnados, psi:Math.round(psi*10000)/10000,
    penalty: Math.round(penalty*10000)/10000,
    drift: Math.round(drift*100)/100,
    attendance: Math.round(attendance*100),
    prodEff: Math.round(prodEff*100),
    revEff: Math.round(revEff*100),
    confirmRate: Math.round(confirmRate*100),
    salesConvRate: Math.round(salesConvRate*100),
    wfScore, finScore, ordScore,
    grossProfit: Math.round(grossProfit),
    netProfit: Math.round(netProfit),
    grossMargin: Math.round(grossMargin*10)/10,
    netMargin: Math.round(netMargin*10)/10,
    capReturn: capReturn!==null ? Math.round(capReturn*10)/10 : null,
    costPerUnit: costPerUnit!==null ? Math.round(costPerUnit*100)/100 : null,
    revPerUnit: revPerUnit!==null ? Math.round(revPerUnit*100)/100 : null,
    ratePerHr: ratePerHr!==null ? Math.round(ratePerHr*10)/10 : null,
    projEOD: projEOD!==null ? Math.round(projEOD) : null,
    targetGap: targetGap!==null ? Math.round(targetGap) : null,
    breakEven, willProfitable,
    projMargin: projMargin!==null ? Math.round(projMargin*10)/10 : null,
    penalties,
    hv, // pass back for charting
  };
}

module.exports = { computeOmega, OC };
