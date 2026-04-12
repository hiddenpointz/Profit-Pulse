'use strict';
/* ═══════════════════════════════════════════════════════════════════════
   PULSE · GET /api/health
   Returns system status + full model metadata / capability manifest
   ═══════════════════════════════════════════════════════════════════════ */
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const OC = 1 / Math.E;

  return res.status(200).json({
    status:   'ONLINE',
    product:  'UEDP Business Pulse',
    version:  '2.0.0',
    engine:   'UEDP v5 — G S Ramesh Kumar',

    // ── Endpoint map ─────────────────────────────────────────────────
    endpoints: {
      compute:     'POST /api/compute             — standard omega computation',
      backtest:    'POST /api/compute {mode:"backtest"}    — historical accuracy check',
      sensitivity: 'POST /api/compute {mode:"sensitivity"} — input perturbation analysis',
      calibrate:   'POST /api/compute {history:[...]}      — auto-tune weights from data',
    },

    // ── Core model parameters ────────────────────────────────────────
    model: {
      omega_crit:        OC,
      omega_crit_source: 'METP variational boundary — non-equilibrium dynamical systems theory',
      omega_ref:         0.70,
      omega_ref_source:  'Heuristic — businesses with omega > 0.70 report positive net margin (field-observed)',
      classification:    'Heuristic decision engine — useful analytical tool, not a proven predictive system',

      validated_outputs: [
        'P&L (grossProfit, netProfit, margins)   — deterministic accounting, fully validated',
        'Iseq (instability index)                — mathematically defined directional chaos metric',
        'OLS drift slope                         — mathematically exact linear regression',
        'Attendance, prodEff, revEff ratios      — deterministic dimensionless ratios',
      ],
      heuristic_outputs: [
        'omega                                   — heuristic composite; validate against your business history',
        'Phi / Gamma / AT                        — theoretically constructed; no independent empirical backing',
        'Alert thresholds (omega < 0.55, etc.)   — designed boundaries, not statistically derived',
      ],

      weights: {
        var:   { value: 0.20, rationale: 'CV² most predictive of intra-day quality failure' },
        spike: { value: 0.15, rationale: 'Acute events (machine/absentee) — second-order signal' },
        drift: { value: 0.10, rationale: 'Slow signal, actionable late-day — lowest weight' },
        dir:   { value: 0.20, rationale: 'Coherence of workforce/production/revenue alignment' },
        cost:  { value: 0.20, rationale: 'Directly determines profitability — co-equal with var' },
        order: { value: 0.15, rationale: 'Lagging pipeline indicator — important, longer horizon' },
        note:  'Override via inp.calibration:{} or auto-tune via inp.history:[] (min 5 records)',
      },

      hard_thresholds: {
        omega_crit:        { value: OC, source: 'Dynamical systems theory (METP)' },
        pay_max_days:      { value: 90, source: '3× net-30 — Dun & Bradstreet high-risk threshold' },
        spike_normalizer:  { value: 3,  source: '3σ-equivalent for hourly production anomaly' },
        proj_hours:        { value: 10, source: 'Assumed 10-hour working day — configurable' },
        sensitivity_delta: { value: '±10%', source: 'Standard perturbation for numerical stability testing' },
      },
    },

    // ── Reliability roadmap (honest, from review) ─────────────────────
    reliability: {
      current_state:     'Internally coherent, numerically stable, directionally correct',
      limitation:        'Weights are heuristic, not data-derived. Thresholds are theoretical.',
      to_improve: [
        'Pass history:[] with actual outcomes to enable OLS weight calibration',
        'Use mode:backtest to measure directional accuracy on your own data',
        'Use mode:sensitivity to identify which inputs drive most omega variance',
        'After 30+ historical records: re-tune weights for your specific business type',
      ],
    },

    outputs: [
      'omega_score', 'Iseq', 'Phi', 'Gamma', 'AT',
      'pl_snapshot', 'profitability_prediction',
      'actionable_alerts', 'sensitivity_analysis',
      'model_meta', 'calibration_info',
    ],

    timestamp: new Date().toISOString(),
  });
};
