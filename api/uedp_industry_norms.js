/**
 * UEDP Industry Norms Dataset
 * ──────────────────────────────────────────────────────────────────────────
 * Author  : G S Ramesh Kumar
 * Protocol: dx.doi.org/10.17504/protocols.io.14egnr5yml5d/v4
 * Paper   : DOI 10.61113/ijiap.v3i12.1223
 *
 * PURPOSE:
 *   Industry-specific penalty weight presets and threshold norms for the
 *   UEDP v4 engine. These are SUGGESTED starting points derived from
 *   published industry benchmarks (OEE, DSO, margin norms, LER standards).
 *   They are NOT empirically validated against UEDP Omega outcomes.
 *   Users should calibrate against their own 30-day history.
 *
 * HOW TO USE:
 *   1. Load this file before your UEDP engine.
 *   2. Call UEDP_NORMS.getPreset('manufacturing') to get a CFG-compatible object.
 *   3. Pass it to computeOmegaCore(inp, preset.W, preset) as the W and cfg args.
 *   4. The preset overrides ONLY W and threshold values — Ω_crit = 1/e is FIXED.
 *
 * WEIGHT LOGIC:
 *   Each weight answers: "How much does THIS failure mode drive loss in THIS industry?"
 *   W.var   = Hourly variance (CV²)          — process consistency
 *   W.spike = Sudden drops (3σ events)        — acute disruptions
 *   W.drift = Declining trend (OLS slope)     — slow degradation
 *   W.dir   = Workforce/revenue alignment     — Labour Efficiency Ratio
 *   W.cost  = Cost vs revenue pressure        — margin sensitivity
 *   W.order = Order pipeline + payment lead   — cashflow predictability
 *   All weights sum to 1.000 (enforced).
 *
 * SOURCES FOR BENCHMARK VALUES:
 *   - OEE world-class targets: SMRP (Society for Maintenance & Reliability Professionals)
 *   - DSO norms: D&B India SME report, RBI MSME data
 *   - Margin benchmarks: Dun & Bradstreet India industry averages, Damodaran NYU
 *   - Labor efficiency: SHRM Benchmarking Reports
 *   - Construction: RERA payment timelines, NIC construction productivity norms
 *   - Education: NAAC quality indicators, UGC norms
 *   - Food & Beverage: NRA (National Restaurant Association) cost benchmarks
 *   - Healthcare: CRISIL Health sector analysis
 *   - Logistics: CRISIL Logistics India, ATKearney
 *   - Technology/SaaS: Bessemer Venture Partners SaaS benchmarks, KeyBanc
 * ──────────────────────────────────────────────────────────────────────────
 */

'use strict';

var UEDP_NORMS = (function() {

  // ── OMEGA_CRIT: FIXED BY METP THEORY — DO NOT CHANGE ──────────────────
  var OC = 1 / Math.E; // 0.36788...

  // ── INDUSTRY PRESETS ────────────────────────────────────────────────────

  var PRESETS = {

    // ── 1. DISCRETE MANUFACTURING ─────────────────────────────────────────
    manufacturing: {
      id: 'manufacturing',
      label: 'Discrete Manufacturing',
      icon: '🏭',
      description: 'Batch/unit production. Variance and machine spikes are the primary Omega suppressors. Margins wide enough to withstand some cost pressure; DSO typically 30–60d.',

      W: { var:0.25, spike:0.20, drift:0.15, dir:0.15, cost:0.15, order:0.10 },

      // Threshold norms (override CFG values)
      omegaRef:          0.70,
      omegaWarnHi:       0.55,
      omegaStableFloor:  0.70,
      payMax:            60,    // D&B India manufacturing DSO norm: 45–60d
      spikeDiv:          3,     // 3σ machine downtime threshold standard
      projHrs:           10,
      attCrit:           70,    // Shift manning: below 70% = line risk
      attWarn:           85,
      marginThin:        10,    // Manufacturing net margin below 10% = thin
      marginTarget:      20,    // World-class net margin target
      confirmWarn:       65,
      convWarn:          45,
      payWarn:           60,
      driftAlert:        -0.5,
      revEffWarn:        65,

      // Industry-specific benchmarks (informational — shown in UI)
      benchmarks: {
        oeeLow:           55,   // OEE% below this = poor (SMRP)
        oeeMedium:        75,   // OEE% typical
        oeeWorldClass:    85,   // OEE% world-class
        grossMarginLow:   20,
        grossMarginTyp:   30,
        grossMarginHigh:  40,
        netMarginTyp:     8,
        dsoTypical:       45,   // days
        dsoAlert:         60,
        attendanceCrit:   70,   // % shift crew
        varianceAlert:    0.12, // CV² above 0.12 = process instability
        source: 'SMRP OEE Standards, Damodaran India Manufacturing Margins, D&B DSO'
      },

      rationale: {
        var:   'Batch consistency = quality and rework cost. CV² is the leading indicator of defect rate.',
        spike: 'Machine downtime events are the canonical loss driver in manufacturing.',
        drift: 'Fatigue, material rundown, or thermal degradation creates measurable OLS decline.',
        dir:   'Workforce-to-output alignment matters but shifts are mostly fixed; less leverage.',
        cost:  'Margins allow some cost pressure; not the primary Omega driver.',
        order: 'B2B orders with 30–60d DSO; pipeline health moderately important.'
      }
    },

    // ── 2. RETAIL / DISTRIBUTION ──────────────────────────────────────────
    retail: {
      id: 'retail',
      label: 'Retail / Distribution',
      icon: '🛒',
      description: 'High-velocity, low-margin. Cost pressure and staff-revenue alignment dominate. Declining trend is the most dangerous signal since missed sales are irrecoverable.',

      W: { var:0.10, spike:0.10, drift:0.20, dir:0.20, cost:0.25, order:0.15 },

      omegaRef:          0.68,
      omegaWarnHi:       0.50,
      omegaStableFloor:  0.68,
      payMax:            30,    // Retail DSO very low — credit card, POS
      spikeDiv:          3,
      projHrs:           10,
      attCrit:           72,
      attWarn:           85,
      marginThin:        4,     // Net margin below 4% = structural risk
      marginTarget:      8,
      confirmWarn:       70,
      convWarn:          50,
      payWarn:           30,
      driftAlert:        -0.4,  // Retail tolerates less drift
      revEffWarn:        70,

      benchmarks: {
        grossMarginLow:   25,
        grossMarginTyp:   38,
        grossMarginHigh:  55,
        netMarginTyp:     3,    // India retail net margin 2–5%
        dsoTypical:       7,    // Mostly cash/credit card
        dsoAlert:         20,
        attendanceCrit:   72,
        varianceAlert:    0.20, // Hourly footfall naturally high variance
        source: 'Damodaran India Retail Margins, CRISIL Retail Report, D&B'
      },

      rationale: {
        var:   'Hourly footfall varies naturally — variance is not a strong Omega signal in retail.',
        spike: 'No machine downtime equivalent; POS failures are brief. Low weight.',
        drift: 'Declining day performance = permanently missed revenue. Critical signal.',
        dir:   'Staff-to-sales alignment is the key lever — understaffing and overstaffing both hurt.',
        cost:  'Net margins of 2–5% mean any cost overrun is immediately structural. Highest weight.',
        order: 'Reorder pipeline and payment terms matter for working capital, moderate importance.'
      }
    },

    // ── 3. CONSTRUCTION / CONTRACTOR ──────────────────────────────────────
    contractor: {
      id: 'contractor',
      label: 'Construction / Contractor',
      icon: '🏗',
      description: 'Project-based, thin margins. Schedule slippage compounds exponentially. Payment cert delay and retention create sustained cashflow risk that dwarfs daily P&L.',

      W: { var:0.10, spike:0.20, drift:0.20, dir:0.10, cost:0.15, order:0.25 },

      omegaRef:          0.68,
      omegaWarnHi:       0.52,
      omegaStableFloor:  0.68,
      payMax:            90,    // RERA: 30d cert + 45d payment = 75d norm, alert at 90
      spikeDiv:          2.5,   // Lower threshold: safety incidents = hard stop
      projHrs:           9,
      attCrit:           68,
      attWarn:           82,
      marginThin:        3,     // Construction net margin 3–7%
      marginTarget:      7,
      confirmWarn:       60,
      convWarn:          40,
      payWarn:           60,    // 60d payment lead = cashflow stress
      driftAlert:        -0.3,  // Schedule drift triggers earlier
      revEffWarn:        60,

      benchmarks: {
        grossMarginTyp:   12,   // Construction gross margin 10–15%
        netMarginLow:     2,
        netMarginTyp:     5,
        netMarginHigh:    8,
        dsoTypical:       60,   // India construction: 45–75d cert+payment
        dsoAlert:         90,
        spiCrit:          0.90,  // Schedule Performance Index
        spiWarn:          0.97,
        reworkAlert:      8,    // Rework % above 8% = quality concern
        attendanceCrit:   68,
        source: 'RERA payment norms, NIC Construction Index, CRISIL Infrastructure'
      },

      rationale: {
        var:   'Day-to-day site output varies by weather, crew — lower weight.',
        spike: 'Safety incidents and material non-delivery stop the project completely. High weight.',
        drift: 'Schedule slippage compounds: 1 day behind becomes 5 days by month end. Critical.',
        dir:   'Labour tracking vs billing alignment matters but is less granular at daily level.',
        cost:  'Margins thin but fairly predictable; not the primary daily signal.',
        order: 'Cert approval, retention, and 60–90d payment lead create sustained cashflow crisis. Highest.'
      }
    },

    // ── 4. EDUCATIONAL INSTITUTION ────────────────────────────────────────
    education: {
      id: 'education',
      label: 'Educational Institution',
      icon: '🎓',
      description: 'Fixed-cost heavy; fee collection is the only revenue lever. No real hourly production variance signal. Pipeline = admissions + fee recovery cycle.',

      W: { var:0.10, spike:0.10, drift:0.15, dir:0.15, cost:0.25, order:0.25 },

      omegaRef:          0.68,
      omegaWarnHi:       0.50,
      omegaStableFloor:  0.68,
      payMax:            30,    // Fee overdue >30d = cashflow risk
      spikeDiv:          3,
      projHrs:           8,    // School day
      attCrit:           75,   // NAAC: below 75% = eligibility risk
      attWarn:           85,
      marginThin:        8,    // Private education net margin 8–20%
      marginTarget:      15,
      confirmWarn:       60,   // Admission conversion below 60% = intake risk
      convWarn:          30,
      payWarn:           30,   // Fee overdue 30d = working capital stress
      driftAlert:        -0.4,
      revEffWarn:        65,

      // Education-specific
      studAttCrit:       75,
      studAttWarn:       85,
      classDelAlert:     90,
      passRateCrit:      70,
      feeRecovWarn:      60,
      syllabusHigh:      2,
      syllabusModerate:  1,

      benchmarks: {
        grossMarginTyp:   40,   // Education gross margin 35–50%
        netMarginLow:     8,
        netMarginTyp:     15,
        netMarginHigh:    25,
        dsoTypical:       15,   // Fee should be collected within 15d of due date
        dsoAlert:         30,
        studentAttCrit:   75,   // UGC/NAAC exam eligibility threshold
        classDeliveryCrit: 90,
        passRateCrit:     70,
        source: 'NAAC Quality Indicators, UGC Attendance Norms, CRISIL Education'
      },

      rationale: {
        var:   'Period delivery naturally varies — not a strong signal.',
        spike: 'Teacher absence is the only real spike; recoverable. Low weight.',
        drift: 'Syllabus coverage trend and attendance trend matter moderately.',
        dir:   'Teacher-student alignment moderately important.',
        cost:  'Fixed salary + ops cost against fee collection: any shortfall is structural. High.',
        order: 'Admission pipeline and fee recovery cycle drive institutional viability. Equal highest.'
      }
    },

    // ── 5. LOGISTICS / SUPPLY CHAIN ───────────────────────────────────────
    logistics: {
      id: 'logistics',
      label: 'Logistics / Supply Chain',
      icon: '🚚',
      description: 'SLA-driven. Delivery time variance and missed delivery spikes directly destroy client relationships and trigger penalties. Direction (utilisation vs revenue) is critical.',

      W: { var:0.25, spike:0.20, drift:0.15, dir:0.20, cost:0.15, order:0.05 },

      omegaRef:          0.70,
      omegaWarnHi:       0.55,
      omegaStableFloor:  0.70,
      payMax:            45,    // Logistics: typically contract-based, shorter DSO
      spikeDiv:          2.5,   // Missed delivery = harder threshold
      projHrs:           10,
      attCrit:           78,    // Driver availability critical
      attWarn:           90,
      marginThin:        3,     // Logistics net margin 2–6%
      marginTarget:      6,
      confirmWarn:       75,
      convWarn:          55,
      payWarn:           45,
      driftAlert:        -0.5,
      revEffWarn:        70,

      benchmarks: {
        grossMarginTyp:   18,
        netMarginLow:     2,
        netMarginTyp:     4,
        netMarginHigh:    7,
        dsoTypical:       30,
        dsoAlert:         45,
        onTimeDeliveryTarget: 95,  // OTD% world class
        onTimeDeliveryWarn:   88,
        vehicleUtilTarget:    80,  // Fleet utilisation % target
        attendanceCrit:    78,
        source: 'ATKearney Logistics Index, CRISIL India Logistics, SHRM'
      },

      rationale: {
        var:   'Delivery time variance destroys SLA compliance scores. Highest weight.',
        spike: 'Missed deliveries trigger client penalties and churn. High weight.',
        drift: 'Fleet efficiency or route optimisation declining trend. Moderate.',
        dir:   'Vehicle/driver utilisation vs revenue per km: critical operational ratio.',
        cost:  'Fuel + driver cost as % of revenue: thin margin but somewhat predictable.',
        order: 'Usually long-term contracts; pipeline uncertainty is lower. Low weight.'
      }
    },

    // ── 6. HEALTHCARE / CLINIC ────────────────────────────────────────────
    healthcare: {
      id: 'healthcare',
      label: 'Healthcare / Clinic',
      icon: '🏥',
      description: 'Appointment + consultation model. Doctor utilisation vs consultation revenue is the core ratio. No-show spikes are acute and irrecoverable.',

      W: { var:0.15, spike:0.20, drift:0.10, dir:0.25, cost:0.25, order:0.05 },

      omegaRef:          0.68,
      omegaWarnHi:       0.52,
      omegaStableFloor:  0.68,
      payMax:            30,    // Insurance/TPA claims: 15–30d norm
      spikeDiv:          2.5,
      projHrs:           9,
      attCrit:           75,    // Doctor attendance critical
      attWarn:           88,
      marginThin:        8,
      marginTarget:      18,
      confirmWarn:       70,    // Appointment confirmation rate
      convWarn:          55,
      payWarn:           30,
      driftAlert:        -0.4,
      revEffWarn:        68,

      benchmarks: {
        grossMarginTyp:   35,
        netMarginLow:     8,
        netMarginTyp:     18,
        netMarginHigh:    30,
        dsoTypical:       15,
        dsoAlert:         30,
        bedOccupancyTarget: 80,  // Hospital bed occupancy %
        doctorUtilTarget:   70,  // Billable consultations / available slots
        noShowWarn:         15,  // No-show rate above 15% = revenue risk
        source: 'CRISIL Health Sector Report, NHA India, JCI Standards'
      },

      rationale: {
        var:   'Appointment adherence varies — some natural variation acceptable.',
        spike: 'No-shows, emergency surges, doctor absences = irrecoverable revenue loss.',
        drift: 'Patient load is fairly stable; drift is less meaningful.',
        dir:   'Doctor utilisation vs consultation revenue: the single most important ratio.',
        cost:  'Consumables + staff + rent with tight insurance reimbursements. Critical.',
        order: 'Walk-in/appointment model, not B2B order pipeline. Minimal weight.'
      }
    },

    // ── 7. TECHNOLOGY / SAAS ──────────────────────────────────────────────
    technology: {
      id: 'technology',
      label: 'Technology / SaaS',
      icon: '💻',
      description: 'Sprint velocity and MRR/ARR pipeline dominate. Declining delivery velocity and pipeline churn are the existential signals. Cost pressure moderate as margins can be high.',

      W: { var:0.10, spike:0.15, drift:0.20, dir:0.20, cost:0.10, order:0.25 },

      omegaRef:          0.72,
      omegaWarnHi:       0.55,
      omegaStableFloor:  0.72,
      payMax:            30,    // SaaS: monthly billing, net-30 standard
      spikeDiv:          3,
      projHrs:           9,
      attCrit:           80,    // Dev team availability critical
      attWarn:           90,
      marginThin:        15,    // SaaS net margin 15–40% target range
      marginTarget:      30,
      confirmWarn:       70,    // Trial-to-paid conversion
      convWarn:          25,    // Lead-to-trial conversion
      payWarn:           30,
      driftAlert:        -0.3,  // Sprint velocity decline triggers early
      revEffWarn:        70,

      benchmarks: {
        grossMarginLow:   60,   // SaaS gross margin target
        grossMarginTyp:   72,
        grossMarginHigh:  85,
        netMarginLow:     10,
        netMarginTyp:     25,
        netMarginHigh:    40,
        dsoTypical:       14,
        dsoAlert:         30,
        mrrGrowthTarget:  10,   // MRR growth % monthly
        churnWarn:        3,    // Monthly churn % above 3% = critical
        nrrTarget:        105,  // Net Revenue Retention % target
        source: 'Bessemer BVP SaaS Index, KeyBanc SaaS Survey, Baremetrics'
      },

      rationale: {
        var:   'Sprint velocity naturally varies; not a strong daily signal.',
        spike: 'Production incidents, deployment failures cause revenue/reputation damage.',
        drift: 'Declining velocity = delivery risk and team health issue. Critical leading indicator.',
        dir:   'Developer capacity vs feature/revenue output: core engineering efficiency ratio.',
        cost:  'Cloud + salary margins can be high; cost pressure less acute than other industries.',
        order: 'MRR/ARR pipeline = survival. Churn + pipeline together are the existential signal.'
      }
    },

    // ── 8. FOOD & BEVERAGE ────────────────────────────────────────────────
    food_beverage: {
      id: 'food_beverage',
      label: 'Food & Beverage',
      icon: '🍽',
      description: 'Shift-based, perishable inventory. Food cost % is the primary KPI. Rush-hour spikes are irrecoverable. Staff alignment per shift = the operating lever.',

      W: { var:0.15, spike:0.20, drift:0.10, dir:0.20, cost:0.30, order:0.05 },

      omegaRef:          0.65,
      omegaWarnHi:       0.50,
      omegaStableFloor:  0.65,
      payMax:            7,     // F&B suppliers: mostly 7–15d credit
      spikeDiv:          2.5,   // Lower threshold: rush-hour failures critical
      projHrs:           10,
      attCrit:           75,    // Below 75% crew = service breakdown
      attWarn:           88,
      marginThin:        5,     // F&B net margin 3–9%
      marginTarget:      9,
      confirmWarn:       75,
      convWarn:          55,
      payWarn:           15,    // Supplier credit 7–15d
      driftAlert:        -0.5,
      revEffWarn:        72,

      benchmarks: {
        foodCostTarget:   28,   // Food cost % of revenue target
        foodCostWarn:     35,   // NRA standard: above 35% = alert
        laborCostTarget:  30,   // Labor cost % of revenue
        laborCostWarn:    38,
        grossMarginTyp:   68,   // F&B gross margin 60–75%
        netMarginLow:     3,
        netMarginTyp:     6,
        netMarginHigh:    12,
        dsoTypical:       1,    // Cash/POS — near-zero
        dsoAlert:         7,
        tableTurnTarget:  3,    // Covers/table/day
        source: 'NRA Restaurant Industry Report, FSSAI India, Technopak F&B India'
      },

      rationale: {
        var:   'Kitchen output varies shift to shift — moderate signal.',
        spike: 'Rush-hour preparation failures and no-shows are irrecoverable revenue losses.',
        drift: 'Service quality decline trend — moderate importance.',
        dir:   'Staff/revenue alignment per shift is the primary operating lever.',
        cost:  'Food cost % is THE primary F&B KPI. Cost pressure gets highest weight.',
        order: 'Mostly walk-in; supplier orders short-cycle. Low pipeline uncertainty.'
      }
    },

    // ── 9. PROFESSIONAL SERVICES / CONSULTING ─────────────────────────────
    professional_services: {
      id: 'professional_services',
      label: 'Professional Services',
      icon: '📋',
      description: 'Billable utilisation is everything. Pipeline (proposals + retainers) and direction (billable vs available hours) dominate. Low variance, high direction sensitivity.',

      W: { var:0.08, spike:0.12, drift:0.15, dir:0.30, cost:0.15, order:0.20 },

      omegaRef:          0.70,
      omegaWarnHi:       0.55,
      omegaStableFloor:  0.70,
      payMax:            45,    // Net-30 to net-45 standard
      spikeDiv:          3,
      projHrs:           9,
      attCrit:           80,    // Consultant availability = delivery capacity
      attWarn:           90,
      marginThin:        15,
      marginTarget:      25,
      confirmWarn:       70,
      convWarn:          40,
      payWarn:           45,
      driftAlert:        -0.3,
      revEffWarn:        70,

      benchmarks: {
        grossMarginTyp:   45,
        netMarginLow:     12,
        netMarginTyp:     22,
        netMarginHigh:    35,
        dsoTypical:       30,
        dsoAlert:         45,
        billableUtilTarget: 75,  // Billable hours as % of available
        billableUtilWarn:   65,
        realisationTarget:  90,  // Billed vs budgeted hours %
        source: 'SHRM Consulting Benchmarks, SPI Research PS Maturity Benchmark'
      },

      rationale: {
        var:   'Project hours vary by nature; not a meaningful daily Omega signal.',
        spike: 'Key person absence causes delivery gap; moderate impact.',
        drift: 'Declining project progress rate is a delivery risk signal.',
        dir:   'Billable utilisation vs total available hours is THE metric. Highest weight.',
        cost:  'Salary + overhead vs billing rate: moderate pressure, manageable margins.',
        order: 'Proposal pipeline + retainer renewal: survival signal. High weight.'
      }
    },

    // ── 10. PROCESS MANUFACTURING (Chemicals/Pharma/FMCG) ────────────────
    process_manufacturing: {
      id: 'process_manufacturing',
      label: 'Process Manufacturing',
      icon: '⚗',
      description: 'Continuous process. Variance IS the quality signal (GMP/GLP compliance). Drift and spikes are critical. Direction less relevant (automated lines). Pipeline moderate.',

      W: { var:0.30, spike:0.25, drift:0.20, dir:0.08, cost:0.12, order:0.05 },

      omegaRef:          0.72,
      omegaWarnHi:       0.58,
      omegaStableFloor:  0.72,
      payMax:            60,
      spikeDiv:          2,     // GMP: tighter tolerance on batch deviations
      projHrs:           12,    // Shift-based continuous operations
      attCrit:           80,    // Operator coverage critical on continuous lines
      attWarn:           90,
      marginThin:        12,
      marginTarget:      22,
      confirmWarn:       70,
      convWarn:          50,
      payWarn:           60,
      driftAlert:        -0.2,  // Process drift triggers at lower threshold
      revEffWarn:        72,

      benchmarks: {
        grossMarginTyp:   40,   // Pharma gross margin 40–60%; FMCG 35–50%
        netMarginLow:     10,
        netMarginTyp:     20,
        netMarginHigh:    35,
        dsoTypical:       45,
        dsoAlert:         60,
        batchVarianceAlert: 0.05, // GMP: batch CV% above 5% = OOS risk
        oeeWorldClass:    85,
        source: 'WHO GMP Guidelines, CRISIL Pharma India, Damodaran FMCG Margins'
      },

      rationale: {
        var:   'Batch variance IS the quality/compliance signal in process industries. Highest weight.',
        spike: 'Batch failure, reactor excursion, contamination event. Very high weight.',
        drift: 'Gradual process drift before OOS (out-of-spec) event. Critical early warning.',
        dir:   'Automated process lines — workforce direction less granular. Low weight.',
        cost:  'Raw material cost + utility cost: moderate pressure, somewhat predictable.',
        order: 'Long production runs with known demand; pipeline uncertainty low.'
      }
    },

  }; // end PRESETS


  // ── THRESHOLD ALERT BENCHMARKS BY INDUSTRY ──────────────────────────────
  // These are industry-specific alert thresholds that override CFG defaults.
  // Basis: published benchmark reports cited in PRESETS[id].benchmarks.source

  var THRESHOLD_NORMS = {

    // PAY_MAX (Days Sales Outstanding alert ceiling)
    payMax: {
      manufacturing:        60,
      retail:               15,
      contractor:           90,
      education:            30,
      logistics:            45,
      healthcare:           30,
      technology:           30,
      food_beverage:        7,
      professional_services: 45,
      process_manufacturing: 60,
      source: 'D&B India DSO norms, RBI MSME data, RERA construction payment timelines'
    },

    // NET MARGIN TARGET (%)
    netMarginTarget: {
      manufacturing:        20,
      retail:               5,
      contractor:           7,
      education:            15,
      logistics:            5,
      healthcare:           18,
      technology:           25,
      food_beverage:        8,
      professional_services: 22,
      process_manufacturing: 20,
      source: 'Damodaran India industry margin database, CRISIL sector reports 2023–24'
    },

    // NET MARGIN THIN ALERT (%) — below this = structural risk even if profitable
    netMarginThin: {
      manufacturing:        10,
      retail:               2,
      contractor:           3,
      education:            8,
      logistics:            2,
      healthcare:           8,
      technology:           12,
      food_beverage:        4,
      professional_services: 12,
      process_manufacturing: 10,
      source: 'Industry distress threshold analysis — below thin margin = covenant breach risk'
    },

    // ATTENDANCE CRITICAL (%) — below this = capacity loss
    attendanceCrit: {
      manufacturing:        70,
      retail:               72,
      contractor:           68,
      education:            75,  // NAAC: 75% student attendance minimum
      logistics:            78,
      healthcare:           75,
      technology:           80,
      food_beverage:        75,
      professional_services: 80,
      process_manufacturing: 80,
      source: 'SHRM staffing benchmarks, NAAC quality indicators, industry operational norms'
    },

    // SPIKE_DIV (σ multiple for acute event detection)
    spikeDiv: {
      manufacturing:        3.0,   // Standard 3σ
      retail:               3.0,
      contractor:           2.5,   // Tighter: safety incidents need earlier detection
      education:            3.0,
      logistics:            2.5,   // SLA sensitivity requires tighter threshold
      healthcare:           2.5,   // No-show spike needs early detection
      technology:           3.0,
      food_beverage:        2.5,
      professional_services: 3.0,
      process_manufacturing: 2.0,  // GMP: tightest — batch deviation detection
      source: 'Statistical process control norms, GMP batch deviation standards'
    },

  };


  // ── WEIGHT VALIDATION ────────────────────────────────────────────────────

  function validateWeights(W) {
    var sum = W.var + W.spike + W.drift + W.dir + W.cost + W.order;
    if (Math.abs(sum - 1.0) > 0.001) {
      console.warn('UEDP_NORMS: weights sum to ' + Math.round(sum*1000)/1000 + ', not 1.000');
      return false;
    }
    return true;
  }


  // ── PUBLIC API ────────────────────────────────────────────────────────────

  return {

    OC: OC,  // expose for reference — DO NOT USE AS CONFIGURABLE

    /**
     * Get a preset by industry ID.
     * Returns an object compatible with UEDP CFG + W.
     * @param {string} industryId — one of the keys in PRESETS
     * @returns {object} preset with .W and threshold overrides
     */
    getPreset: function(industryId) {
      var p = PRESETS[industryId];
      if (!p) {
        console.warn('UEDP_NORMS: unknown industry "' + industryId + '". Using default.');
        return null;
      }
      validateWeights(p.W);
      return JSON.parse(JSON.stringify(p));  // deep copy
    },

    /**
     * List all available industry presets.
     * @returns {Array} [{id, label, icon, description}]
     */
    listPresets: function() {
      return Object.keys(PRESETS).map(function(id) {
        return {
          id:          PRESETS[id].id,
          label:       PRESETS[id].label,
          icon:        PRESETS[id].icon,
          description: PRESETS[id].description
        };
      });
    },

    /**
     * Get a specific threshold norm for an industry.
     * @param {string} threshold — e.g. 'payMax', 'netMarginTarget'
     * @param {string} industryId
     * @returns {number|null}
     */
    getThreshold: function(threshold, industryId) {
      if (!THRESHOLD_NORMS[threshold]) return null;
      return THRESHOLD_NORMS[threshold][industryId] || null;
    },

    /**
     * Get all threshold norms for an industry as a flat object.
     * Useful for populating CFG overrides.
     * @param {string} industryId
     * @returns {object}
     */
    getThresholdsForIndustry: function(industryId) {
      var result = {};
      Object.keys(THRESHOLD_NORMS).forEach(function(key) {
        if (key === 'source') return;
        var val = THRESHOLD_NORMS[key][industryId];
        if (val !== undefined) result[key] = val;
      });
      return result;
    },

    /**
     * Merge a preset into an existing CFG object.
     * Overwrites W and threshold fields. Ω_crit remains 1/e.
     * @param {object} cfg — existing CFG
     * @param {string} industryId
     * @returns {object} merged CFG
     */
    applyPresetToCFG: function(cfg, industryId) {
      var preset = this.getPreset(industryId);
      if (!preset) return cfg;
      var merged = JSON.parse(JSON.stringify(cfg));
      // Apply W
      merged.W = preset.W;
      // Apply threshold overrides (only defined fields)
      var threshold_keys = ['omegaRef','omegaWarnHi','omegaStableFloor','payMax','spikeDiv',
        'projHrs','attCrit','attWarn','marginThin','marginTarget','confirmWarn','convWarn',
        'payWarn','driftAlert','revEffWarn','studAttCrit','studAttWarn','classDelAlert',
        'passRateCrit','feeRecovWarn','syllabusHigh','syllabusModerate'];
      threshold_keys.forEach(function(k) {
        if (preset[k] !== undefined) merged[k] = preset[k];
      });
      return merged;
    },

    /**
     * Get the full benchmarks object for an industry.
     * Used for display purposes (show industry norms alongside actual metrics).
     * @param {string} industryId
     * @returns {object|null}
     */
    getBenchmarks: function(industryId) {
      var p = PRESETS[industryId];
      return p ? JSON.parse(JSON.stringify(p.benchmarks)) : null;
    },

    /**
     * Get the rationale text for each weight in an industry.
     * Used in UI to explain WHY each weight has its value.
     * @param {string} industryId
     * @returns {object|null} {var, spike, drift, dir, cost, order}
     */
    getRationale: function(industryId) {
      var p = PRESETS[industryId];
      return p ? JSON.parse(JSON.stringify(p.rationale)) : null;
    },

    /**
     * Compare actual Omega against industry norms.
     * Returns interpretation of where the business stands vs its peers.
     * @param {number} omega — actual Omega value
     * @param {string} industryId
     * @returns {object} {status, percentile_note, action}
     */
    interpretOmega: function(omega, industryId) {
      var p = PRESETS[industryId];
      if (!p) return null;
      var ref  = p.omegaRef || 0.70;
      var warn = p.omegaWarnHi || 0.55;
      if (omega >= ref) return {
        status: 'ABOVE_INDUSTRY_REF',
        note: 'Omega is at or above the ' + p.label + ' reference level of ' + ref + '. System coherence is industry-healthy.',
        action: 'Maintain. Focus on compounding gains.'
      };
      if (omega >= warn) return {
        status: 'BELOW_REF_STABLE',
        note: 'Omega is below the ' + p.label + ' reference (' + ref + ') but above the stress threshold (' + warn + ').',
        action: 'Address top penalty driver. Monitor for drift below ' + warn + '.'
      };
      if (omega >= OC) return {
        status: 'STRESS_ZONE',
        note: 'Omega is in the stress zone for ' + p.label + '. Between Ω_crit (0.368) and the industry stress threshold (' + warn + ').',
        action: 'Intervene. Top penalty driver is suppressing coherence toward critical boundary.'
      };
      return {
        status: 'BELOW_CRITICAL',
        note: 'Omega has crossed Ω_crit = 1/e. System is in the critical zone for ' + p.label + '. METP boundary crossed.',
        action: 'Immediate action required. Cost of delay exceeds cost of intervention.'
      };
    },

    /**
     * Validate that a set of weights conforms to UEDP requirements.
     * @param {object} W
     * @returns {boolean}
     */
    validateWeights: validateWeights,

    // Expose raw presets for advanced use
    _presets: PRESETS,
    _thresholds: THRESHOLD_NORMS,

  };

})();


// ── If running in Node.js / CommonJS ──────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UEDP_NORMS;
}

// ── Quick self-test ────────────────────────────────────────────────────────
if (typeof window === 'undefined') {
  // Node environment — run quick checks
  var presets = UEDP_NORMS.listPresets();
  console.log('UEDP_NORMS loaded. Presets available:');
  presets.forEach(function(p) {
    var preset = UEDP_NORMS.getPreset(p.id);
    var sum = Object.values(preset.W).reduce(function(a,b){return a+b;},0);
    var ok = Math.abs(sum - 1.0) < 0.001;
    console.log('  ' + (ok?'✓':'✗') + ' ' + p.icon + ' ' + p.label + ' (W sum = ' + Math.round(sum*1000)/1000 + ')');
  });
  console.log('Omega_crit = 1/e = ' + UEDP_NORMS.OC.toFixed(6) + ' (fixed by METP theory)');
}
