'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   PULSE · POST /api/compute
   FULLY SELF-CONTAINED — zero external require() — works on Vercel
   ═══════════════════════════════════════════════════════════════════════
   Input (JSON body):
   {
     hourlyProd:       number[],   // productivity per hour (up to 10)
     hourlyTargets:    number[],   // target per hour (same length)
     empPresent:       number,
     empTotal:         number,
     runningCost:      number,     // variable cost today ₹
     fixedCost:        number,     // daily overhead share ₹
     capital:          number,     // capital deployed today ₹
     outputVol:        number,     // units produced
     outputValue:      number,     // ₹ revenue realised / booked
     targetValue:      number,     // ₹ daily revenue target
     ordersReceived:   number,
     ordersConfirmed:  number,
     timeToConfirmHrs: number,
     paymentLeadDays:  number,
     salesLeads:       number,     // factory+sales: pipeline leads
     salesClosed:      number,
     mixItems:         [{name,vol,unitValue}],
     hoursElapsed:     number,
     prodUnit:         string,
   }
   ═══════════════════════════════════════════════════════════════════════ */

const OC = 1/Math.E;  // 0.36788...

// ── Signal primitives ─────────────────────────────────────────────────────
function mean(x){return x.length?x.reduce((s,v)=>s+v,0)/x.length:0;}
function variance(x){if(x.length<2)return 0;const m=mean(x);return x.reduce((s,v)=>s+(v-m)**2,0)/x.length;}
function spikeIndex(x){if(x.length<2)return 0;const m=mean(x)||1;let mx=0;for(let i=1;i<x.length;i++)mx=Math.max(mx,Math.abs(x[i]-x[i-1]));return mx/m;}
function driftSlope(x){if(x.length<2)return 0;const n=x.length,sx=(n*(n-1))/2,sx2=((n-1)*n*(2*n-1))/6,sy=x.reduce((s,v)=>s+v,0),sxy=x.reduce((s,v,i)=>s+i*v,0),d=n*sx2-sx*sx;return d===0?0:(n*sxy-sx*sy)/d;}
function clamp(v,lo=0,hi=1){return Math.min(hi,Math.max(lo,v));}

function computeIseq(seq){
  if(seq.length<3)return 0;
  const dirs=[];for(let i=1;i<seq.length;i++)dirs.push(seq[i]>seq[i-1]?1:seq[i]<seq[i-1]?-1:0);
  let B=0,S=0;
  for(let i=1;i<dirs.length;i++){
    const cos=(dirs[i]===0||dirs[i-1]===0)?0:dirs[i]*dirs[i-1];
    B+=(1-cos);
    if(dirs[i]!==0&&dirs[i-1]!==0&&dirs[i]!==dirs[i-1])S++;
  }
  return Math.min(2,B/dirs.length+S/(S+1));
}

// ── Core UEDP engine ──────────────────────────────────────────────────────
function computeOmega(inp){
  const EP=1e-9;
  const hourlyProd=inp.hourlyProd||[], hourlyTargets=inp.hourlyTargets||[];
  const empPresent=inp.empPresent||0, empTotal=Math.max(inp.empTotal||1,1);
  const runningCost=inp.runningCost||0, fixedCost=inp.fixedCost||0, capital=inp.capital||0;
  const outputVol=inp.outputVol||0, outputValue=inp.outputValue||0, targetValue=inp.targetValue||0;
  const ordersReceived=inp.ordersReceived||0, ordersConfirmed=inp.ordersConfirmed||0;
  const paymentLeadDays=inp.paymentLeadDays||30;
  const salesLeads=inp.salesLeads||0, salesClosed=inp.salesClosed||0;
  const hoursElapsed=inp.hoursElapsed||8;
  const mixItems=inp.mixItems||[];

  const totalCost=runningCost+fixedCost;
  const hv=hourlyProd.filter(v=>!isNaN(v)&&v>=0);
  const ht=hourlyTargets.filter(v=>!isNaN(v)&&v>0);
  const avgTarget=ht.length?mean(ht):0;

  const attendance  =clamp(empPresent/empTotal);
  const prodEff     =(hv.length&&avgTarget>0)?clamp(mean(hv)/avgTarget):(hv.length?0.5:0.3);
  const revEff      =targetValue>0?clamp(outputValue/targetValue):(totalCost>0?clamp(outputValue/totalCost):0.5);
  const confirmRate =ordersReceived>0?clamp(ordersConfirmed/ordersReceived):1;
  const salesConvRate=salesLeads>0?clamp(salesClosed/salesLeads):1;

  const dirMag=clamp(Math.sqrt(([attendance,prodEff,revEff].reduce((s,v)=>s+v*v,0))/3));

  const normVar   =clamp(hv.length>=2?variance(hv)/(mean(hv)**2+EP):0);
  const normSpike =clamp(hv.length>=2?spikeIndex(hv)/3:0);
  const drift     =hv.length>=2?driftSlope(hv):0;
  const normDrift =clamp(Math.abs(drift)/((mean(hv)||1)+EP));
  const normDir   =clamp(1-dirMag);
  const margin    =totalCost>0?(outputValue-totalCost)/totalCost:0;
  const normCost  =clamp(margin<0?1:Math.max(0,1-margin));
  const payPenalty=clamp(paymentLeadDays>90?1:paymentLeadDays/90)*0.3;
  const confirmPen=clamp(1-confirmRate*0.6-salesConvRate*0.4);
  const normOrder =clamp(confirmPen*0.7+payPenalty);

  const W={var:0.20,spike:0.15,drift:0.10,dir:0.20,cost:0.20,order:0.15};
  const penalty=W.var*normVar+W.spike*normSpike+W.drift*normDrift+W.dir*normDir+W.cost*normCost+W.order*normOrder;
  const mag=outputValue/(totalCost+EP);
  const psi=clamp(mag/(mag+1));
  const omega=clamp(psi*Math.exp(-penalty));

  const Iseq=computeIseq(hv);
  const OmegaRef=0.70, tau=OmegaRef-omega;
  const Rmag=Math.abs(tau)/(OmegaRef+EP);
  const Rmod=(tau>0&&omega<OC)?-Rmag:Rmag;
  const dOmega=Math.max(OC-omega,EP);
  const Icoh=Math.max(0,1-Iseq);
  const Phi=(Icoh*Rmod)/dOmega;
  const ODebt=Math.max(OC-omega,0);
  const Gamma=(ODebt*penalty+EP)/(Math.abs(Rmod)+EP);
  const Upsilon=Math.abs(Rmod);
  const AT=(Upsilon*Math.abs(Phi))/(Iseq*Gamma+EP);

  const grossProfit=outputValue-runningCost, netProfit=outputValue-totalCost;
  const grossMargin=outputValue>0?grossProfit/outputValue*100:0;
  const netMargin=outputValue>0?netProfit/outputValue*100:0;
  const capReturn=capital>0?netProfit/capital*100:null;
  const costPerUnit=outputVol>0?totalCost/outputVol:null;
  const revPerUnit=outputVol>0?outputValue/outputVol:null;
  const ratePerHr=hoursElapsed>0?outputVol/hoursElapsed:null;
  const projEOD=ratePerHr?ratePerHr*10:null;
  const targetGap=targetValue>0?targetValue-outputValue:null;
  const projMargin=(projEOD&&costPerUnit&&revPerUnit)?
    (projEOD*revPerUnit-totalCost)/Math.max(projEOD*revPerUnit,EP)*100:null;

  const wfScore =Math.round(clamp(attendance*0.5+(1-normVar)*0.3+(1-normSpike)*0.2)*100);
  const finScore=Math.round(clamp(revEff*0.5+(1-normCost)*0.5)*100);
  const ordScore=Math.round(clamp(confirmRate*0.5+salesConvRate*0.3+(1-payPenalty/0.3)*0.2)*100);

  const penalties=[
    {key:'hourly_variance',  score:W.var*normVar,    raw:normVar,    label:'Hourly Productivity Variance'},
    {key:'spike',            score:W.spike*normSpike, raw:normSpike,  label:'Sudden Hour-to-Hour Drops'},
    {key:'drift',            score:W.drift*normDrift, raw:normDrift,  label:'Declining Productivity Trend'},
    {key:'direction',        score:W.dir*normDir,     raw:normDir,    label:'Workforce/Revenue Misalignment'},
    {key:'cost_overrun',     score:W.cost*normCost,   raw:normCost,   label:'Cost vs Revenue Pressure'},
    {key:'order_pipeline',   score:W.order*normOrder, raw:normOrder,  label:'Order/Sales Pipeline Health'},
  ].sort((a,b)=>b.score-a.score);

  // Mix value check
  const mixRevenue=mixItems.reduce((s,m)=>(s+(m.vol||0)*(m.unitValue||0)),0);

  const r=v=>typeof v==='number'?Math.round(v*10000)/10000:v;
  const r2=v=>typeof v==='number'?Math.round(v*100)/100:v;
  return {
    omega:r(omega), Iseq:r(Iseq), Rmod:r(Rmod), Phi:r(Phi),
    Gamma:r(Gamma), AT:r2(AT), isAnados:AT>1,
    psi:r(psi), penalty:r(penalty), drift:r2(drift),
    attendance:Math.round(attendance*100), prodEff:Math.round(prodEff*100),
    revEff:Math.round(revEff*100), confirmRate:Math.round(confirmRate*100),
    salesConvRate:Math.round(salesConvRate*100),
    wfScore, finScore, ordScore,
    grossProfit:Math.round(grossProfit), netProfit:Math.round(netProfit),
    grossMargin:r2(grossMargin), netMargin:r2(netMargin),
    capReturn:capReturn!==null?r2(capReturn):null,
    costPerUnit:costPerUnit!==null?r2(costPerUnit):null,
    revPerUnit:revPerUnit!==null?r2(revPerUnit):null,
    ratePerHr:ratePerHr!==null?r2(ratePerHr):null,
    projEOD:projEOD!==null?Math.round(projEOD):null,
    targetGap:targetGap!==null?Math.round(targetGap):null,
    projMargin:projMargin!==null?r2(projMargin):null,
    willProfitable:netProfit>0, breakEven:Math.round(totalCost),
    mixRevenue:Math.round(mixRevenue),
    penalties, hv,
  };
}

// ── Alert engine ──────────────────────────────────────────────────────────
function generateAlerts(result, inp){
  const alerts=[];
  const {omega,Iseq,AT,isAnados,grossMargin,netMargin,netProfit,projEOD,targetGap,
         attendance,confirmRate,salesConvRate,penalties,drift,projMargin,willProfitable,hv}=result;
  const {empTotal=1,empPresent=0,runningCost=0,fixedCost=0,targetValue=0,outputValue=0,
         ordersReceived=0,ordersConfirmed=0,paymentLeadDays=30,salesLeads=0,salesClosed=0,
         hoursElapsed=8,prodUnit='units'}=inp;
  const totalCost=(runningCost+fixedCost);

  const push=(sev,cat,title,detail,action)=>alerts.push({severity:sev,category:cat,title,detail,action});
  const INR=v=>v.toLocaleString('en-IN');

  // 1. Omega critical
  if(omega<OC) push('critical','UEDP',
    `Ω ${result.omega} — CRITICAL (below 1/e threshold)`,
    `Business coherence has crossed the METP variational boundary. The cost of waiting now exceeds the cost of acting. Top driver: ${penalties[0]?.label}.`,
    `Address "${penalties[0]?.label}" immediately. Every hour of delay compounds the instability.`);
  else if(omega<0.55) push('warning','UEDP',
    `Ω ${result.omega} — Stressed, approaching critical zone`,
    `Primary drag: ${penalties[0]?.label} (${Math.round((penalties[0]?.raw||0)*100)}% normalised penalty). Secondary: ${penalties[1]?.label}.`,
    `Stabilise ${penalties[0]?.label} before adding cost or workload.`);

  // 2. Profitability prediction
  const predConf=hoursElapsed>=6?'HIGH':hoursElapsed>=4?'MEDIUM':'LOW';
  push(willProfitable&&netMargin>=10?'ok':willProfitable?'warning':'critical','PREDICTION',
    `Profitability forecast (${predConf} confidence): ${willProfitable?'PROFITABLE':'LOSS'} day`,
    willProfitable
      ?`Projected net margin ${projMargin!==null?projMargin:netMargin}% on ₹${INR(outputValue)} revenue. ${isAnados?'A/T confirms generative momentum.':'A/T < 1 — monitor closely.'}`
      :`At current rate, today closes at −₹${INR(Math.abs(netProfit))}. Break-even: ₹${INR(totalCost)}.`,
    willProfitable
      ?`Maintain current rate. Focus on order confirmation (${confirmRate}%) and payment follow-up.`
      :`Reduce discretionary cost, push unconfirmed orders, maximise output in remaining ${10-hoursElapsed}h.`);

  // 3. P&L
  if(!willProfitable) push('critical','P&L',
    `Net loss ₹${INR(Math.abs(netProfit))} — margin ${netMargin}%`,
    `Output value ₹${INR(outputValue)} vs total cost ₹${INR(totalCost)}.`,
    projEOD?`At current rate, EOD output: ${projEOD} ${prodUnit}. Need ₹${INR(totalCost)} revenue to break even.`:`Cut variable cost or raise output immediately.`);
  else if(netMargin<8) push('warning','P&L',
    `Thin margin ${netMargin}% — target >15%`,
    `₹${INR(netProfit)} net on ₹${INR(outputValue)} revenue. Any cost spike tips into loss.`,
    `Shift mix toward higher-margin products in remaining hours.`);

  // 4. Target gap
  if(targetGap&&targetGap>0&&hoursElapsed>=5){
    const pct=targetValue>0?Math.round(outputValue/targetValue*100):0;
    const hoursLeft=Math.max(0,10-hoursElapsed);
    const needed=hoursLeft>0?Math.round(targetGap/hoursLeft/100)*100:null;
    push(pct<60?'critical':'warning','TARGET',
      `${pct}% of daily target — gap ₹${INR(targetGap)}`,
      `${hoursLeft}h left. ${needed?`Need ₹${INR(needed)}/hr`:'Need major acceleration'} to close.`,
      projEOD?`Projected EOD: ${projEOD} ${prodUnit}${projMargin!==null?` (est. margin ${projMargin}%)`:'.'}`:`Push highest-margin SKU in remaining hours.`);
  }

  // 5. Workforce
  if(attendance<80){
    const absent=empTotal-empPresent;
    push(attendance<65?'critical':'warning','WORKFORCE',
      `Attendance ${attendance}% — ${absent} absent of ${empTotal}`,
      `${absent} workers absent. Expected throughput: ${attendance}% of normal.`,
      `Reassign to highest-value tasks. Critical-role absences: consider overtime.`);
  }

  // 6. Productivity drift
  if(drift<-0.5&&hv.length>=4) push('warning','PRODUCTION',
    `Output declining: ${Math.abs(Math.round(drift*10)/10)} ${prodUnit}/hr per hour`,
    `Productivity falls as day progresses — fatigue, material, or machine issue.`,
    `Check: raw material stock, machine maintenance, fatigue rotation.`);

  // 7. Order pipeline
  if(ordersReceived>0&&confirmRate<60) push('warning','SALES',
    `Order confirmation ${confirmRate}% — ${ordersReceived-ordersConfirmed} unconfirmed`,
    `Unconfirmed orders = uncertain revenue. At ${paymentLeadDays}d lead, delay compounds.`,
    `Follow up today. Is gap pricing, capacity, or customer hesitation?`);

  if(salesLeads>0&&salesConvRate<40) push('warning','SALES',
    `Sales conversion ${salesConvRate}% — ${salesLeads-salesClosed} open leads`,
    `Low conversion increases Omega penalty in order dimension.`,
    `Review why leads aren't closing. Pricing, fit, or follow-up lag?`);

  if(paymentLeadDays>60) push('warning','CASHFLOW',
    `Payment lead ${paymentLeadDays} days — working capital risk`,
    `₹${INR(Math.round(runningCost*paymentLeadDays))} tied up in receivables at current run rate.`,
    `Negotiate 2/10 net 30. Prioritise clients with faster payment history.`);

  // 8. A/T direction warning
  if(!isAnados&&omega>OC) push('warning','UEDP',
    `A/T ratio ${result.AT} < 1 — Thanatos despite stable Ω`,
    `Depleting forces exceed constructive energy. Omega is above critical but trending down.`,
    `Reduce top penalty driver: ${penalties[0]?.label}.`);

  const rank={critical:0,warning:1,ok:2};
  alerts.sort((a,b)=>(rank[a.severity]||3)-(rank[b.severity]||3));
  return alerts.slice(0,8);
}

// ── Route handler ─────────────────────────────────────────────────────────
module.exports=(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({error:'POST only'});

  const inp=req.body||{};
  if(!inp.empTotal&&!inp.outputValue&&!(inp.hourlyProd&&inp.hourlyProd.length)){
    return res.status(400).json({error:'Provide at least empTotal, outputValue, or hourlyProd'});
  }

  try{
    const result=computeOmega(inp);
    const alerts=generateAlerts(result,inp);
    return res.status(200).json({
      status:'ok',
      timestamp:new Date().toISOString(),
      omega_crit:OC,
      result,
      alerts,
      input_echo:{
        prodUnit:inp.prodUnit||'units',
        hoursElapsed:inp.hoursElapsed||8,
        mixItems:inp.mixItems||[],
      }
    });
  }catch(e){
    return res.status(500).json({error:e.message});
  }
};
