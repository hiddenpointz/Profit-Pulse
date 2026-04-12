'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   PULSE · POST /api/compute   (UEDP v5 Business Pulse — Upgraded v2.0)
   FULLY SELF-CONTAINED — zero external require() — works on Vercel edge

   UPGRADE NOTES vs v1.0:
   ① All weights documented with rationale (no longer "arbitrary")
   ② All hard thresholds have documented empirical/theoretical source
   ③ Composite metrics (Phi, Gamma, AT) carry confidence_flag
   ④ Sensitivity analysis: perturbs inputs ±10%, reports instability
   ⑤ Weight calibration: pass history[] to auto-tune weights via OLS
   ⑥ Backtest endpoint: pass mode:'backtest' to score historical accuracy
   ⑦ model_meta returned with every response — full transparency

   Input (JSON body):
   {
     hourlyProd:        number[],   // units per hour (up to 10)
     hourlyTargets:     number[],   // target per hour (same length)
     empPresent:        number,
     empTotal:          number,
     runningCost:       number,     // variable cost today ₹
     fixedCost:         number,     // daily overhead share ₹
     capital:           number,     // capital deployed today ₹
     outputVol:         number,     // total units produced so far
     outputValue:       number,     // ₹ revenue realised / booked
     targetValue:       number,     // ₹ daily revenue target
     ordersReceived:    number,
     ordersConfirmed:   number,
     paymentLeadDays:   number,
     salesLeads:        number,
     salesClosed:       number,
     mixItems:          [{name,vol,unitValue}],
     hoursElapsed:      number,     // hours since business day start
     prodUnit:          string,     // label ("units", "kg", "pieces")
     calibration:       object,     // optional: {var,spike,drift,dir,cost,order}
     history:           [{inputs:{...}, actual_profitable:bool,
                          actual_net_margin:number, date:string}],
     mode:              string,     // 'compute'(default)|'backtest'|'sensitivity'
   }
   ═══════════════════════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────────────────────────
// MODEL ASSUMPTIONS — every hard-coded number is documented here
// ─────────────────────────────────────────────────────────────────────────────
const MA = {
  OC:        1/Math.E,     // METP equilibrium boundary — dynamical systems theory
  OmegaRef:  0.70,         // Healthy business target — heuristic, field-observed
  PAY_MAX:   90,           // 3× net-30 = industry high-risk threshold (D&B reference)
  SPIKE_DIV: 3,            // 3σ equivalent for hourly production anomaly
  PROJ_HRS:  10,           // assumed working day length for EOD projection
  W: {
    var:   { v:0.20, why:'CV² most predictive of intra-day quality failure' },
    spike: { v:0.15, why:'Acute events (machine fault, absentee) — second-order' },
    drift: { v:0.10, why:'Slow signal, actionable late-day — lowest weight' },
    dir:   { v:0.20, why:'Coherence of workforce/production/revenue alignment' },
    cost:  { v:0.20, why:'Directly determines profitability — co-equal with var' },
    order: { v:0.15, why:'Lagging indicator — important but slower horizon' },
  },
};

const OC = MA.OC;

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const mean = x => x.length ? x.reduce((s,v)=>s+v,0)/x.length : 0;

const variance = x => {
  if (x.length < 2) return 0;
  const m = mean(x);
  return x.reduce((s,v)=>s+(v-m)**2,0)/x.length;
};

const spikeIndex = x => {
  if (x.length < 2) return 0;
  const m = mean(x) || 1;
  let mx = 0;
  for (let i=1;i<x.length;i++) mx = Math.max(mx, Math.abs(x[i]-x[i-1]));
  return mx/m;
};

const driftSlope = x => {
  // OLS slope — mathematically exact, no magic numbers
  if (x.length < 2) return 0;
  const n = x.length;
  const sx=(n*(n-1))/2, sx2=((n-1)*n*(2*n-1))/6;
  const sy=x.reduce((s,v)=>s+v,0), sxy=x.reduce((s,v,i)=>s+i*v,0);
  const d=n*sx2-sx*sx;
  return d===0 ? 0 : (n*sxy-sx*sy)/d;
};

const clamp = (v,lo=0,hi=1) => Math.min(hi,Math.max(lo,v));

const pearson = (x,y) => {
  if (x.length!==y.length||x.length<2) return 0;
  const mx=mean(x),my=mean(y);
  const num=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0);
  const den=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)*y.reduce((s,v)=>s+(v-my)**2,0));
  return den<1e-9?0:num/den;
};

// ─────────────────────────────────────────────────────────────────────────────
// INSTABILITY INDEX  I_seq ∈ [0, 2]
// 0 = perfectly monotone, 2 = maximum reversal chaos
// Mathematically well-defined, no free parameters
// ─────────────────────────────────────────────────────────────────────────────
const computeIseq = seq => {
  if (seq.length<3) return 0;
  const dirs=[];
  for(let i=1;i<seq.length;i++) dirs.push(seq[i]>seq[i-1]?1:seq[i]<seq[i-1]?-1:0);
  let B=0,S=0;
  for(let i=1;i<dirs.length;i++){
    const cos=(dirs[i]===0||dirs[i-1]===0)?0:dirs[i]*dirs[i-1];
    B+=(1-cos);
    if(dirs[i]!==0&&dirs[i-1]!==0&&dirs[i]!==dirs[i-1])S++;
  }
  return Math.min(2,B/dirs.length+S/(S+1));
};

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHT CALIBRATION via OLS (addresses "arbitrary weights" feedback)
// Requires ≥5 historical records. Blends data-signal with prior.
// Returns { W, calibrated, n, blend }
// ─────────────────────────────────────────────────────────────────────────────
const tuneWeights = (history, defaultW) => {
  if (!history||history.length<5) return {W:defaultW,calibrated:false,n:history?.length||0};
  const EP=1e-9;
  const rows=history.map(h=>{
    const hv=(h.inputs.hourlyProd||[]).filter(v=>!isNaN(v)&&v>=0);
    const ht=(h.inputs.hourlyTargets||[]).filter(v=>!isNaN(v)&&v>0);
    const tc=(h.inputs.runningCost||0)+(h.inputs.fixedCost||0);
    const ov=h.inputs.outputValue||0;
    const tv=h.inputs.targetValue||0;
    const att=clamp((h.inputs.empPresent||0)/Math.max(h.inputs.empTotal||1,1));
    const pe=(hv.length&&ht.length)?clamp(mean(hv)/(mean(ht)||1)):0.5;
    const re=tv>0?clamp(ov/tv):0.5;
    const dir=clamp(Math.sqrt(([att,pe,re].reduce((s,v)=>s+v*v,0))/3));
    const mg=mean(hv)||1;
    return {
      normVar:   clamp(hv.length>=2?variance(hv)/(mg**2+EP):0),
      normSpike: clamp(hv.length>=2?spikeIndex(hv)/MA.SPIKE_DIV:0),
      normDrift: clamp(hv.length>=2?Math.abs(driftSlope(hv))/(mg+EP):0),
      normDir:   clamp(1-dir),
      normCost:  clamp(tc>0?Math.max(0,(tc-ov)/tc):0),
      normOrder: 0.5,
      actual:    h.actual_profit_margin||0,
    };
  });
  const keys=['normVar','normSpike','normDrift','normDir','normCost','normOrder'];
  const actual=rows.map(r=>r.actual);
  const wMap={normVar:'var',normSpike:'spike',normDrift:'drift',normDir:'dir',normCost:'cost',normOrder:'order'};
  const corrs={};
  let totAbs=0;
  for(const k of keys){
    corrs[k]=Math.abs(pearson(rows.map(r=>r[k]),actual));
    totAbs+=corrs[k];
  }
  if(totAbs<1e-6) return {W:defaultW,calibrated:false,n:history.length};
  const BLEND=Math.min(0.60,(history.length-4)/20);
  const W={};
  for(const k of keys){
    const dw=corrs[k]/totAbs;
    W[wMap[k]]=clamp(BLEND*dw+(1-BLEND)*defaultW[wMap[k]],0.05,0.40);
  }
  const s=Object.values(W).reduce((a,v)=>a+v,0);
  for(const k of Object.keys(W)) W[k]=Math.round(W[k]/s*10000)/10000;
  return {W,calibrated:true,n:history.length,blend:Math.round(BLEND*100)/100};
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE OMEGA ENGINE (pure function — testable, deterministic)
// ─────────────────────────────────────────────────────────────────────────────
const computeOmegaCore = (inp, W) => {
  const EP=1e-9;
  const hprod=inp.hourlyProd||[], htarg=inp.hourlyTargets||[];
  const ep=Math.max(inp.empPresent||0,0), et=Math.max(inp.empTotal||1,1);
  const rc=inp.runningCost||0, fc=inp.fixedCost||0, cap=inp.capital||0;
  const ov=inp.outputVol||0, oval=inp.outputValue||0, tv=inp.targetValue||0;
  const or=inp.ordersReceived||0, oc2=inp.ordersConfirmed||0;
  const pl=inp.paymentLeadDays||30;
  const sl=inp.salesLeads||0, sc2=inp.salesClosed||0;
  const he=inp.hoursElapsed||8;
  const mix=inp.mixItems||[];

  const tc=rc+fc;
  const hv=hprod.filter(v=>!isNaN(v)&&v>=0);
  const ht=htarg.filter(v=>!isNaN(v)&&v>0);
  const avgT=ht.length?mean(ht):0;

  // ── Sub-scores ─────────────────────────────────────────────────────────
  const att   =clamp(ep/et);
  const prodEf=(hv.length&&avgT>0)?clamp(mean(hv)/avgT):(hv.length?0.5:0.3);
  const revEf =tv>0?clamp(oval/tv):(tc>0?clamp(oval/tc):0.5);
  const confR =or>0?clamp(oc2/or):1;
  const convR =sl>0?clamp(sc2/sl):1;
  const dirMag=clamp(Math.sqrt(([att,prodEf,revEf].reduce((s,v)=>s+v*v,0))/3));

  // ── Penalty features ───────────────────────────────────────────────────
  const mg      =mean(hv)||1;
  const nVar    =clamp(hv.length>=2?variance(hv)/(mg**2+EP):0);
  const nSpike  =clamp(hv.length>=2?spikeIndex(hv)/MA.SPIKE_DIV:0);
  const dslope  =hv.length>=2?driftSlope(hv):0;
  const nDrift  =clamp(Math.abs(dslope)/(mg+EP));
  const nDir    =clamp(1-dirMag);
  const marg    =tc>0?(oval-tc)/tc:0;
  const nCost   =clamp(marg<0?1:Math.max(0,1-marg));
  const payPen  =clamp(pl>=MA.PAY_MAX?1:pl/MA.PAY_MAX)*0.3;
  const confPen =clamp(1-confR*0.6-convR*0.4);
  const nOrder  =clamp(confPen*0.7+payPen);

  // ── Omega ─────────────────────────────────────────────────────────────
  const penalty =W.var*nVar+W.spike*nSpike+W.drift*nDrift+W.dir*nDir+W.cost*nCost+W.order*nOrder;
  // psi = Michaelis-Menten saturation: bounded [0,1], smooth, no singularity
  const mag2=oval/(tc+EP);
  const psi =clamp(mag2/(mag2+1));
  const omega=clamp(psi*Math.exp(-penalty));

  // ── UEDP derived ─────────────────────────────────────────────────────
  const Iseq  =computeIseq(hv);
  const tau   =MA.OmegaRef-omega;
  const Rmag  =Math.abs(tau)/(MA.OmegaRef+EP);
  const Rmod  =(tau>0&&omega<OC)?-Rmag:Rmag;
  const dOmega=Math.max(OC-omega,EP);
  const Icoh  =Math.max(0,1-Iseq);
  const Phi   =(Icoh*Rmod)/dOmega;
  const ODebt =Math.max(OC-omega,0);
  const Gamma =(ODebt*penalty+EP)/(Math.abs(Rmod)+EP);
  const Upsilon=Math.abs(Rmod);
  const AT    =(Upsilon*Math.abs(Phi))/(Iseq*Gamma+EP);

  // ── P&L ──────────────────────────────────────────────────────────────
  const gp=oval-rc, np=oval-tc;
  const gm=oval>0?gp/oval*100:0, nm=oval>0?np/oval*100:0;
  const cr=cap>0?np/cap*100:null;
  const cpu=ov>0?tc/ov:null, rpu=ov>0?oval/ov:null;
  const rph=he>0?ov/he:null;
  const peod=rph?rph*MA.PROJ_HRS:null;
  const tgap=tv>0?tv-oval:null;
  const pm=(peod&&cpu&&rpu)?(peod*rpu-tc)/Math.max(peod*rpu,EP)*100:null;

  // ── Dimension scores ─────────────────────────────────────────────────
  const wfs=Math.round(clamp(att*0.5+(1-nVar)*0.3+(1-nSpike)*0.2)*100);
  const fs =Math.round(clamp(revEf*0.5+(1-nCost)*0.5)*100);
  const os =Math.round(clamp(confR*0.5+convR*0.3+(1-payPen/0.3)*0.2)*100);

  const pens=[
    {key:'hourly_variance',  score:W.var*nVar,    raw:nVar,    label:'Hourly Productivity Variance',   validated:'statistical',  assumption:'CV² normalization'},
    {key:'spike',            score:W.spike*nSpike, raw:nSpike,  label:'Sudden Hour-to-Hour Drops',     validated:'statistical',  assumption:`Spike > ${MA.SPIKE_DIV}× mean`},
    {key:'drift',            score:W.drift*nDrift, raw:nDrift,  label:'Declining Productivity Trend',  validated:'mathematical', assumption:'OLS slope/mean'},
    {key:'direction',        score:W.dir*nDir,     raw:nDir,    label:'Workforce/Revenue Misalignment',validated:'heuristic',    assumption:'Direction vector coherence'},
    {key:'cost_overrun',     score:W.cost*nCost,   raw:nCost,   label:'Cost vs Revenue Pressure',      validated:'accounting',   assumption:'Margin normalization'},
    {key:'order_pipeline',   score:W.order*nOrder, raw:nOrder,  label:'Order/Sales Pipeline Health',   validated:'industry-ref', assumption:`${MA.PAY_MAX}d lead = stress max`},
  ].sort((a,b)=>b.score-a.score);

  const mixRev=mix.reduce((s,m)=>s+(m.vol||0)*(m.unitValue||0),0);

  return {
    omega, Iseq, Rmod, Phi, Gamma, AT, isAnados:AT>1,
    psi, penalty, drift:dslope,
    attendance:att, prodEff:prodEf, revEff:revEf, confirmRate:confR, salesConvRate:convR,
    wfScore:wfs, finScore:fs, ordScore:os,
    grossProfit:gp, netProfit:np, grossMargin:gm, netMargin:nm,
    capReturn:cr, costPerUnit:cpu, revPerUnit:rpu, ratePerHr:rph,
    projEOD:peod, targetGap:tgap, projMargin:pm,
    willProfitable:np>0, breakEven:Math.round(tc), mixRevenue:Math.round(mixRev),
    nVar, nSpike, nDrift, nDir, nCost, nOrder,
    penalties:pens, hv,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// SENSITIVITY ANALYSIS  (addresses "hard threshold / stability" feedback)
// Perturbs each scalar input ±DELTA%, computes omega swing.
// Swing > 0.05 = unstable region — alert consumer.
// ─────────────────────────────────────────────────────────────────────────────
const computeSensitivity = (inp, W) => {
  const DELTA=0.10;
  const keys=['outputValue','runningCost','fixedCost','empPresent','paymentLeadDays'];
  const base=computeOmegaCore(inp,W).omega;
  let maxSwing=0;
  const swings={};
  for(const k of keys){
    const bv=inp[k]||0;
    if(bv===0) continue;
    const hi=computeOmegaCore({...inp,[k]:bv*(1+DELTA)},W).omega;
    const lo=computeOmegaCore({...inp,[k]:bv*(1-DELTA)},W).omega;
    const s=Math.abs(hi-lo);
    swings[k]=Math.round(s*10000)/10000;
    if(s>maxSwing) maxSwing=s;
  }
  return {
    base_omega:    Math.round(base*10000)/10000,
    perturbation:  `±${DELTA*100}%`,
    max_swing:     Math.round(maxSwing*10000)/10000,
    swings,
    stable:        maxSwing<0.05,
    warning:       maxSwing>=0.05
      ?`Model sensitivity: ±${Math.round(maxSwing*100)}% omega swing. Verify input accuracy.`
      :null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKTEST ENGINE  (addresses "no empirical calibration" feedback)
// ─────────────────────────────────────────────────────────────────────────────
const runBacktest = (history, W) => {
  if(!history||history.length<2) return {error:'Need ≥2 historical records'};
  let hits=0, marginErr=0, margN=0;
  const details=history.map(h=>{
    const r=computeOmegaCore(h.inputs,W);
    const pred=r.willProfitable;
    const act=h.actual_profitable;
    const ok=pred===act;
    if(ok) hits++;
    if(typeof h.actual_net_margin==='number'){
      marginErr+=Math.abs(r.netMargin-h.actual_net_margin);
      margN++;
    }
    return{date:h.date||null,omega:Math.round(r.omega*10000)/10000,
           predicted_profitable:pred,actual_profitable:act,correct:ok};
  });
  const hr=Math.round(hits/history.length*100);
  const mae=margN>0?Math.round(marginErr/margN*10)/10:null;
  return{
    hit_rate_pct:hr, hits, total:history.length,
    mae_margin_pct:mae,
    grade:hr>=70?'GOOD':hr>=55?'MODERATE':'POOR',
    note:hr>=70?'Directional accuracy acceptable for operational use.'
               :'Low accuracy — tune weights by adding more history[] records.',
    details,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// ALERT ENGINE (upgraded: confidence labels, model caveat, Iseq alert)
// ─────────────────────────────────────────────────────────────────────────────
const generateAlerts = (result, inp, calibInfo) => {
  const alerts=[];
  const{omega,Iseq,AT,isAnados,netMargin,netProfit,projEOD,targetGap,
        attendance,confirmRate,salesConvRate,penalties,drift,projMargin,
        willProfitable,hv,revEff}=result;
  const{empTotal=1,empPresent=0,runningCost=0,fixedCost=0,targetValue=0,
        outputValue=0,ordersReceived=0,ordersConfirmed=0,paymentLeadDays=30,
        salesLeads=0,salesClosed=0,hoursElapsed=8,prodUnit='units'}=inp;
  const tc=runningCost+fixedCost;
  const push=(sev,cat,title,detail,action,conf='HIGH')=>
    alerts.push({severity:sev,category:cat,title,detail,action,confidence:conf});
  const INR=v=>Math.round(v).toLocaleString('en-IN');
  const mcav=calibInfo?.calibrated
    ?`(Calibrated on ${calibInfo.n} days)`
    :'(Heuristic model — cross-validate with your records)';

  // 1. Omega gate
  if(omega<OC){
    push('critical','UEDP',
      `Ω ${result.omega} — CRITICAL (below 1/e equilibrium boundary)`,
      `System has crossed the METP variational boundary (Ω_crit=1/e≈0.368). Restoring cost > delay cost. Top driver: ${penalties[0]?.label}. ${mcav}`,
      `Act on "${penalties[0]?.label}" immediately. Each hour of delay compounds penalty exponentially.`,
      calibInfo?.calibrated?'HIGH':'MEDIUM');
  } else if(omega<0.55){
    push('warning','UEDP',
      `Ω ${result.omega} — Stressed (approaching critical zone)`,
      `Primary drag: ${penalties[0]?.label} (${Math.round((penalties[0]?.raw||0)*100)}%). Secondary: ${penalties[1]?.label}. ${mcav}`,
      `Stabilise "${penalties[0]?.label}" before adding workload or cost.`,'MEDIUM');
  }

  // 2. Instability alert (NEW — based on Iseq)
  if(Iseq>1.0&&hv.length>=4){
    push('warning','PRODUCTION',
      `High output chaos — Iseq ${result.Iseq} (direction reversals detected)`,
      `Hourly output is reversing frequently (not just declining — erratic). Cause: batch inconsistency, operator rotation, or intermittent machine fault.`,
      `Log per-hour cause. Identify which hours reverse. Isolate machine or operator variable.`,'HIGH');
  }

  // 3. Profitability forecast
  const predConf=hoursElapsed>=6?'HIGH':hoursElapsed>=4?'MEDIUM':'LOW';
  push(
    willProfitable&&netMargin>=10?'ok':willProfitable?'warning':'critical','PREDICTION',
    `Profitability forecast (${predConf} data confidence): ${willProfitable?'PROFITABLE':'LOSS'} day`,
    willProfitable
      ?`Projected net margin ${projMargin!==null?projMargin:netMargin}% on ₹${INR(outputValue)} revenue. ${isAnados?'A/T>1 — constructive momentum.':'A/T<1 — monitor closely.'}`
      :`At current rate, closes at −₹${INR(Math.abs(netProfit))}. Break-even: ₹${INR(tc)}.`,
    willProfitable
      ?`Maintain pace. Confirm pending orders (rate: ${Math.round(confirmRate*100)}%). Follow up on payments.`
      :`Reduce variable cost, push unconfirmed orders, maximise output in ${Math.max(0,10-hoursElapsed)}h remaining.`,
    predConf);

  // 4. P&L
  if(!willProfitable){
    push('critical','P&L',
      `Net loss ₹${INR(Math.abs(netProfit))} — margin ${netMargin}%`,
      `Output ₹${INR(outputValue)} vs cost ₹${INR(tc)}.`,
      projEOD?`EOD projection: ${projEOD} ${prodUnit} at current rate. Need ₹${INR(tc)} revenue to break even.`
             :`Raise output volume or cut variable cost immediately.`);
  } else if(netMargin<8){
    push('warning','P&L',
      `Thin margin ${netMargin}% — target >15%`,
      `₹${INR(netProfit)} net on ₹${INR(outputValue)} revenue. One cost spike tips into loss.`,
      `Prioritise higher-margin SKUs in remaining hours.`);
  }

  // 5. Revenue target gap
  if(targetGap&&targetGap>0&&hoursElapsed>=5){
    const pct=targetValue>0?Math.round(outputValue/targetValue*100):0;
    const hl=Math.max(0,10-hoursElapsed);
    const needed=hl>0?Math.round(targetGap/hl/100)*100:null;
    push(pct<60?'critical':'warning','TARGET',
      `${pct}% of daily target achieved — gap ₹${INR(targetGap)}`,
      `${hl}h left. ${needed?`Need ₹${INR(needed)}/hr to close`:'Need major acceleration'}.`,
      projEOD?`Projected EOD: ${projEOD} ${prodUnit}${projMargin!==null?` (est. margin ${projMargin}%)`:''}.`
             :`Push highest-margin SKU now.`);
  }

  // 6. Workforce
  if(attendance<0.80){
    const absent=empTotal-empPresent;
    const attPct=Math.round(attendance*100);
    push(attPct<65?'critical':'warning','WORKFORCE',
      `Attendance ${attPct}% — ${absent} absent of ${empTotal}`,
      `Throughput capacity: ${attPct}% of normal.`,
      `Reassign to critical tasks. Overtime for key roles if possible.`);
  }

  // 7. Productivity drift (OLS slope — mathematically exact)
  if(drift<-0.5&&hv.length>=4){
    push('warning','PRODUCTION',
      `Declining trend: −${Math.abs(Math.round(drift*10)/10)} ${prodUnit}/hr per hour (OLS)`,
      `Systematic decline as day progresses — fatigue, material shortage, or machine degradation.`,
      `Check: material stock, machine condition, operator rotation.`);
  }

  // 8. Order pipeline
  if(ordersReceived>0&&confirmRate<0.60){
    push('warning','SALES',
      `Order confirmation ${Math.round(confirmRate*100)}% — ${ordersReceived-ordersConfirmed} unconfirmed`,
      `Unconfirmed = uncertain revenue. At ${paymentLeadDays}d lead, delay compounds cash risk.`,
      `Follow up today. Pricing issue, capacity problem, or hesitation?`);
  }
  if(salesLeads>0&&salesConvRate<0.40){
    push('warning','SALES',
      `Sales conversion ${Math.round(salesConvRate*100)}% — ${salesLeads-salesClosed} open leads`,
      `Low conversion increases order pipeline penalty in Ω calculation.`,
      `Identify close barrier: price, fit, or follow-up lag.`);
  }
  if(paymentLeadDays>60){
    push('warning','CASHFLOW',
      `Payment lead ${paymentLeadDays} days — receivables risk`,
      `₹${INR(runningCost*paymentLeadDays)} tied up in receivables at current run rate.`,
      `Negotiate 2/10 net 30. Prioritise faster-paying clients.`);
  }

  // 9. A/T direction
  if(!isAnados&&omega>OC){
    push('warning','UEDP',
      `A/T ratio ${result.AT} < 1 — Thanatos mode despite stable Ω`,
      `Depleting forces exceed constructive energy. Omega stable but trending adversely.`,
      `Reduce "${penalties[0]?.label}" — the primary drag.`);
  }

  // 10. Revenue efficiency low (NEW)
  if(revEff<0.60&&targetValue>0){
    push('warning','REVENUE',
      `Revenue efficiency ${Math.round(revEff*100)}% of target — below 60%`,
      `Actual revenue is significantly behind plan despite current cost structure.`,
      `Review pricing adherence, output quality, and order mix.`);
  }

  const rank={critical:0,warning:1,ok:2};
  alerts.sort((a,b)=>(rank[a.severity]||3)-(rank[b.severity]||3));
  return alerts.slice(0,10);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLER
// ─────────────────────────────────────────────────────────────────────────────
module.exports=(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST')    return res.status(405).json({error:'POST only'});

  const inp=req.body||{};
  if(!inp.empTotal&&!inp.outputValue&&!(inp.hourlyProd&&inp.hourlyProd.length)){
    return res.status(400).json({error:'Provide at least empTotal, outputValue, or hourlyProd[]'});
  }

  try{
    // ── Resolve weights ─────────────────────────────────────────────────
    const defaultW={};
    for(const[k,v] of Object.entries(MA.W)) defaultW[k]=v.v;

    let W=defaultW, calibInfo={source:'default',calibrated:false};

    if(inp.calibration&&typeof inp.calibration==='object'){
      const ow={...defaultW,...inp.calibration};
      const s=Object.values(ow).reduce((a,v)=>a+v,0);
      for(const k of Object.keys(ow)) ow[k]/=s;
      W=ow; calibInfo={source:'caller_override',calibrated:true};
    } else if(inp.history&&inp.history.length>=5){
      const t=tuneWeights(inp.history,defaultW);
      W=t.W; calibInfo={source:t.calibrated?'data_tuned':'default',
                         calibrated:t.calibrated,n:t.n,blend:t.blend};
    }

    // ── Mode routing ────────────────────────────────────────────────────
    const mode=inp.mode||'compute';

    if(mode==='backtest'){
      if(!inp.history||inp.history.length<2)
        return res.status(400).json({error:'backtest mode requires history[] with ≥2 records'});
      const bt=runBacktest(inp.history,W);
      return res.status(200).json({
        status:'ok',mode:'backtest',timestamp:new Date().toISOString(),
        backtest:bt,weights_used:W,calibration:calibInfo,
      });
    }

    if(mode==='sensitivity'){
      const r=computeOmegaCore(inp,W);
      const sens=computeSensitivity(inp,W);
      return res.status(200).json({
        status:'ok',mode:'sensitivity',timestamp:new Date().toISOString(),
        omega:Math.round(r.omega*10000)/10000,
        sensitivity:sens,weights_used:W,calibration:calibInfo,
      });
    }

    // ── Standard compute ────────────────────────────────────────────────
    const raw=computeOmegaCore(inp,W);

    // Round helpers
    const r4=v=>typeof v==='number'?Math.round(v*10000)/10000:v;
    const r2=v=>typeof v==='number'?Math.round(v*100)/100:v;
    const r0=v=>typeof v==='number'?Math.round(v):v;
    const rp=v=>v!==null&&typeof v==='number'?r2(v):v;

    const result={
      // Core UEDP
      omega:    r4(raw.omega),   omega_confidence:'heuristic',
      Iseq:     r4(raw.Iseq),    Iseq_confidence:'mathematical',
      Rmod:     r4(raw.Rmod),
      Phi:      r4(raw.Phi),     Phi_confidence:'theoretical',
      Gamma:    r4(raw.Gamma),   Gamma_confidence:'theoretical',
      AT:       r2(raw.AT),      AT_confidence:'theoretical',
      isAnados: raw.AT>1,
      psi:      r4(raw.psi),
      penalty:  r4(raw.penalty),
      drift:    r2(raw.drift),
      // Operational
      attendance:    Math.round(raw.attendance*100),
      prodEff:       Math.round(raw.prodEff*100),
      revEff:        Math.round(raw.revEff*100),
      confirmRate:   Math.round(raw.confirmRate*100),
      salesConvRate: Math.round(raw.salesConvRate*100),
      wfScore:  raw.wfScore,
      finScore: raw.finScore,
      ordScore: raw.ordScore,
      // P&L
      grossProfit: r0(raw.grossProfit),
      netProfit:   r0(raw.netProfit),
      grossMargin: r2(raw.grossMargin),
      netMargin:   r2(raw.netMargin),
      capReturn:   rp(raw.capReturn),
      costPerUnit: rp(raw.costPerUnit),
      revPerUnit:  rp(raw.revPerUnit),
      ratePerHr:   rp(raw.ratePerHr),
      projEOD:     raw.projEOD!==null?r0(raw.projEOD):null,
      targetGap:   raw.targetGap!==null?r0(raw.targetGap):null,
      projMargin:  rp(raw.projMargin),
      willProfitable: raw.willProfitable,
      breakEven:   raw.breakEven,
      mixRevenue:  raw.mixRevenue,
      penalties: raw.penalties.map(p=>({...p,score:r4(p.score),raw:r4(p.raw)})),
      hv: raw.hv,
      weights_used: W,
      calibration:  calibInfo,
    };

    const alerts=generateAlerts(result,inp,calibInfo);

    // Sensitivity included by default (lightweight)
    const sens=computeSensitivity(inp,W);

    // Model meta — full transparency to address "arbitrary" criticism
    const model_meta={
      system:'UEDP v5 Business Pulse — G S Ramesh Kumar',
      version:'2.0.0',
      omega_crit:OC,
      omega_crit_source:'METP variational boundary (non-equilibrium dynamical systems theory)',
      classification:'Heuristic decision engine — not an empirically validated predictive model',
      validated_components:['Iseq (mathematical)','OLS drift slope (mathematical)',
                            'P&L accounting (deterministic)','Attendance ratio (deterministic)'],
      heuristic_components:['Omega weights','Phi/Gamma/AT composites','OmegaRef target',
                            'Alert thresholds'],
      to_make_more_reliable:['Provide history[] to enable weight calibration',
                             'Use mode:backtest to measure directional accuracy',
                             'Use mode:sensitivity to detect unstable input regions'],
      assumptions: Object.fromEntries(
        Object.entries(MA).filter(([k])=>k!=='W').map(([k,v])=>[k,v])
      ),
      weight_justifications: Object.fromEntries(
        Object.entries(MA.W).map(([k,v])=>[k,{value:v.v,rationale:v.why}])
      ),
    };

    return res.status(200).json({
      status:'ok',
      timestamp:new Date().toISOString(),
      omega_crit:OC,
      result,
      alerts,
      sensitivity:sens,
      model_meta,
      input_echo:{
        prodUnit:inp.prodUnit||'units',
        hoursElapsed:inp.hoursElapsed||8,
        mixItems:inp.mixItems||[],
        mode,
      },
    });

  } catch(e){
    return res.status(500).json({error:e.message, stack:e.stack});
  }
};
