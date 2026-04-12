// api/_alerts.js  —  Alert & Recommendation Engine
// Inlined into api/compute.js (no cross-file require on Vercel)
'use strict';

const OC = 1/Math.E;

function generateAlerts(result, input) {
  const alerts = [];
  const {
    omega, Iseq, Rmod, AT, isAnados,
    grossMargin, netMargin, netProfit, projEOD, targetGap,
    attendance, prodEff, revEff, confirmRate, salesConvRate,
    penalties, drift, wfScore, finScore, ordScore, projMargin,
    willProfitable,
  } = result;

  const {
    empTotal=1, empPresent=0, runningCost=0, fixedCost=0,
    targetValue=0, outputValue=0, outputVol=0,
    ordersReceived=0, ordersConfirmed=0,
    paymentLeadDays=30, salesLeads=0, salesClosed=0,
    hoursElapsed=8, prodUnit='units', mixItems=[],
  } = input;

  // ── 1. Omega state ─────────────────────────────────────────────────────
  if (omega < OC) {
    alerts.push({
      severity: 'critical',
      category: 'UEDP',
      title: `Business Coherence CRITICAL — Ω ${omega} is below 1/e threshold`,
      detail: `Your operational system has crossed the METP critical boundary (Ω_crit = 1/e ≈ 0.368). This means the accumulated cost of instability now exceeds the cost of intervention. The top driver is: ${penalties[0]?.label}.`,
      action: `Address "${penalties[0]?.label}" immediately. Every hour of delay compounds the Omega deficit.`,
    });
  } else if (omega < 0.55) {
    alerts.push({
      severity: 'warning',
      category: 'UEDP',
      title: `Omega stressed at ${omega} — approaching critical zone`,
      detail: `Two more points of pressure and Ω will cross 1/e. Primary drag: ${penalties[0]?.label} (${Math.round(penalties[0]?.raw*100)}% normalised).`,
      action: `Stabilise ${penalties[0]?.label} before adding any new load or cost.`,
    });
  }

  // ── 2. Profitability prediction ────────────────────────────────────────
  if (!willProfitable) {
    alerts.push({
      severity: 'critical',
      category: 'P&L',
      title: `Operating at a LOSS today — net margin ${netMargin}%`,
      detail: `Current output value ₹${outputValue.toLocaleString('en-IN')} is below total cost ₹${(runningCost+fixedCost).toLocaleString('en-IN')} by ₹${Math.abs(netProfit).toLocaleString('en-IN')}.`,
      action: projEOD
        ? `At current rate, projected EOD output: ${projEOD} ${prodUnit}. Need to reach ₹${(runningCost+fixedCost).toLocaleString('en-IN')} revenue to break even.`
        : `Reduce variable cost or increase output volume immediately.`,
    });
  } else if (netMargin < 8) {
    alerts.push({
      severity: 'warning',
      category: 'P&L',
      title: `Thin net margin — ${netMargin}% (target: >15%)`,
      detail: `Only ₹${netProfit.toLocaleString('en-IN')} net profit on ₹${outputValue.toLocaleString('en-IN')} revenue. Any cost surprise will tip into loss.`,
      action: `Review which product in your mix has the lowest unit margin and reduce its share if possible.`,
    });
  }

  // ── 3. Daily target gap ────────────────────────────────────────────────
  if (targetGap && targetGap > 0 && hoursElapsed >= 5) {
    const pctAchieved = targetValue > 0 ? Math.round(outputValue/targetValue*100) : 0;
    const hoursLeft = 10 - hoursElapsed;
    const neededPerHr = hoursLeft > 0 ? Math.round(targetGap/hoursLeft/100)*100 : null;
    alerts.push({
      severity: pctAchieved < 60 ? 'critical' : 'warning',
      category: 'TARGET',
      title: `${pctAchieved}% of daily revenue target — gap: ₹${targetGap.toLocaleString('en-IN')}`,
      detail: `With ${hoursElapsed}h elapsed and ${hoursLeft}h remaining, you need${neededPerHr ? ` ₹${neededPerHr.toLocaleString('en-IN')} per hour` : ' significant acceleration'} to hit today's target.`,
      action: projEOD
        ? `Projected EOD output at current rate: ${projEOD} ${prodUnit}${projMargin!==null ? ` (projected margin: ${projMargin}%)` : ''}.`
        : `Maximise throughput on highest-margin products in remaining hours.`,
    });
  }

  // ── 4. Profitability prediction answer ────────────────────────────────
  const predConfidence = hoursElapsed >= 6 ? 'HIGH' : hoursElapsed >= 4 ? 'MEDIUM' : 'LOW';
  alerts.push({
    severity: willProfitable && netMargin >= 10 ? 'ok' : willProfitable ? 'warning' : 'critical',
    category: 'PREDICTION',
    title: `Profitability prediction (${predConfidence} confidence): ${willProfitable ? 'PROFITABLE' : 'LOSS'} day`,
    detail: willProfitable
      ? `Based on ${hoursElapsed}h of data: projected net margin ${projMargin!==null ? projMargin : netMargin}% on revenue of ₹${outputValue.toLocaleString('en-IN')}. ${isAnados ? 'UEDP A/T ratio confirms generative momentum.' : 'A/T ratio indicates depletion — monitor closely.'}`
      : `At the current rate, today will close at a loss of ₹${Math.abs(netProfit).toLocaleString('en-IN')}. ${projEOD ? `EOD projection: ${projEOD} ${prodUnit}.` : ''}`,
    action: willProfitable
      ? `Hold course. Focus on order confirmation (${confirmRate}% rate) and payment follow-up (${paymentLeadDays}d lead).`
      : `Escalate: reduce discretionary running cost, push unconfirmed orders, and maximise output in remaining hours.`,
  });

  // ── 5. Workforce ─────────────────────────────────────────────────────
  if (attendance < 80) {
    const absent = empTotal - empPresent;
    alerts.push({
      severity: attendance < 65 ? 'critical' : 'warning',
      category: 'WORKFORCE',
      title: `Low attendance: ${attendance}% (${absent} absent of ${empTotal})`,
      detail: `Absent workers are the primary driver of reduced throughput. Expected capacity is ${Math.round(attendance)}% of normal.`,
      action: `Reassign present workers to highest-value tasks. If critical roles are empty, consider overtime or cross-training.`,
    });
  }

  // ── 6. Hourly productivity trend ──────────────────────────────────────
  if (drift < -0.5 && result.hv.length >= 4) {
    alerts.push({
      severity: 'warning',
      category: 'PRODUCTION',
      title: `Productivity declining: −${Math.abs(drift)} ${prodUnit}/hr per hour`,
      detail: `Output is falling as the day progresses. This typically indicates fatigue, machine degradation, material running low, or mounting rework.`,
      action: `Check: raw material stock, machine temperature/maintenance status, fatigue rotation for workers.`,
    });
  }

  // ── 7. Order pipeline / Sales ────────────────────────────────────────
  if (ordersReceived > 0 && confirmRate < 60) {
    alerts.push({
      severity: 'warning',
      category: 'SALES',
      title: `Order confirmation rate ${confirmRate}% — ${ordersReceived - ordersConfirmed} unconfirmed orders`,
      detail: `Unconfirmed orders represent uncertain revenue. At ${paymentLeadDays}d payment lead, each day of delay in confirming costs working capital.`,
      action: `Follow up today. Identify if the gap is pricing, capacity, or customer hesitation.`,
    });
  }

  if (salesLeads > 0 && salesConvRate < 40) {
    alerts.push({
      severity: 'warning',
      category: 'SALES',
      title: `Sales conversion ${salesConvRate}% — ${salesLeads - salesClosed} leads not closed`,
      detail: `Low conversion is reducing pipeline Omega. Each unconverted lead is a sunk cost of sales effort.`,
      action: `Review why leads aren't closing — pricing, product fit, or follow-up lag?`,
    });
  }

  if (paymentLeadDays > 60) {
    alerts.push({
      severity: 'warning',
      category: 'CASHFLOW',
      title: `Payment lead ${paymentLeadDays} days — cash flow risk`,
      detail: `With running cost ₹${runningCost.toLocaleString('en-IN')}/day, a ${paymentLeadDays}-day wait creates working capital pressure of ₹${Math.round(runningCost*paymentLeadDays).toLocaleString('en-IN')}.`,
      action: `Negotiate early payment discount (2/10 net 30). Prioritise clients with better payment history.`,
    });
  }

  // ── 8. A/T direction ─────────────────────────────────────────────────
  if (!isAnados && omega > OC) {
    alerts.push({
      severity: 'warning',
      category: 'UEDP',
      title: `A/T ratio ${AT} < 1 — Thanatos state despite stable Omega`,
      detail: `Depleting forces (instability × burden) exceed constructive energy. The system is above critical threshold but headed the wrong way.`,
      action: `Reduce the top penalty driver: ${penalties[0]?.label}. Otherwise Omega will decline over the next few hours.`,
    });
  }

  // Sort: critical first, then warning, then ok
  const rank = {critical:0, warning:1, ok:2};
  alerts.sort((a,b) => (rank[a.severity]||3)-(rank[b.severity]||3));
  return alerts.slice(0, 7);
}

module.exports = { generateAlerts };
