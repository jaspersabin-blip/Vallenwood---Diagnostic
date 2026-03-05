// api/diagnostic.js
// Drop-in replacement (OS-first + production hardening).
// ✅ OS score is the headline everywhere (API + report + emails)
// ✅ Legacy score remains computed, stored ONLY under report.scoring.legacy
// ✅ Auth supports x-vw-token OR Authorization: Bearer <token>
// ✅ Insufficient-data mode (Option 2) with missing-fields transparency
// ✅ Defensive answer normalization (trim strings, empty->null, arrays handled)
// ✅ Optional report_json via INCLUDE_REPORT_JSON=1
// ✅ Versioning + Zapier-friendly summary output
// ✅ Keeps optional LLM enrichment (audit only)

import OpenAI from "openai";
import { createDiagLogger } from "../lib/diagLogger.js";

/* =========================================================
   Helpers
========================================================= */

function cap(n, max) {
  return Math.max(0, Math.min(Number(n) || 0, max));
}

function scoreBand(totalScore) {
  if (totalScore >= 80) return "High Brand-to-GTM alignment";
  if (totalScore >= 65) return "Moderate system friction";
  if (totalScore >= 50) return "Structural GTM misalignment";
  return "Severe growth constraints";
}

function prettyPillar(key) {
  const map = {
    positioning: "Positioning & Category",
    value_architecture: "Value Architecture",
    pricing_packaging: "Pricing & Packaging",
    gtm_focus: "GTM Focus",
    measurement: "Measurement",
  };
  return map[key] || key || null;
}

function normalizeChannels(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    return val
      .split(/,|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function cleanScalar(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? null : t;
  }
  if (typeof v === "number" || typeof v === "boolean") return v;
  // For objects/arrays, return as-is; higher level normalization will handle where needed.
  return v;
}

// Defensive normalization for incoming answers object:
// - trims strings
// - converts "" to null
// - preserves arrays (and cleans strings inside arrays)
function normalizeIncomingAnswers(answers) {
  const out = {};
  for (const [kRaw, vRaw] of Object.entries(answers || {})) {
    const k = String(kRaw || "").trim();
    if (!k) continue;

    if (Array.isArray(vRaw)) {
      out[k] = vRaw
        .map((x) => (typeof x === "string" ? x.trim() : x))
        .filter((x) => !(typeof x === "string" && x === ""));
      if (out[k].length === 0) out[k] = null;
    } else {
      out[k] = cleanScalar(vRaw);
    }
  }
  return out;
}

// Optional: map verbose question strings to stable keys
function normalizeAnswers(answers) {
  return {
    annual_revenue: answers["Annual Revenue"] ?? null,
    revenue_model: answers["Primary Revenue Model"] ?? null,
    acv: answers["Average Contract Value (ACV)"] ?? null,
    sales_cycle: answers["Average Sales Cycle Length"] ?? null,
    close_rate: answers["Close Rate (%)"] ?? null,

    category: answers["What category do you compete in?"] ?? null,
    compared_to: answers["Who do customers compare you to most often?"] ?? null,

    win_reason: answers["Why do you most often win deals?"] ?? null,
    lose_reason: answers["Why do you most often lose deals?"] ?? null,
    positioning_consistency:
      answers["Do customers describe your company consistently?"] ?? null,

    roi_repeatable: answers["Can you quantify ROI for most customers?"] ?? null,
    sales_lead: answers["Sales conversations primarily lead with:"] ?? null,
    financial_metrics_improved:
      answers["What financial metrics do customers see improve due to your product?"] ??
      null,

    discounting: answers["How often are discounts required to close deals?"] ?? null,
    pricing_clarity:
      answers["Do customers clearly understand your pricing tiers?"] ?? null,
    gross_margin: answers["What is your gross margin (%)?"] ?? null,

    acquisition_channels:
      answers["What are your primary acquisition channels (select up to 3)"] ?? null,
    cac_by_channel: answers["Do you know CAC by channel?"] ?? null,

    growth_status: answers["How would you rate your growth status?"] ?? null,
    marketing_measured_by: answers["Marketing is measured primarily by:"] ?? null,
    attribution_trusted: answers["Is attribution trusted internally?"] ?? null,
    forecast_accuracy: answers["Are revenue forecasts accurate within 10%"] ?? null,
  };
}

/* =========================================================
   Brand-to-GTM OS Score (v1.0)
   5 pillars x 20 points = 100
========================================================= */

const OS_SCORING_VERSION = "os_v1.0";

function computeBrandToGtmOsScore(inputs) {
  const pillar_scores = {
    positioning: 0,
    value_architecture: 0,
    pricing_packaging: 0,
    gtm_focus: 0,
    measurement: 0,
  };

  // Light firmographic modifiers
  const revenueModMap = {
    "Under $5M": 0,
    "$5–10M": 1,
    "$10–25M": 2,
    "$25–50M": 3,
    "$50–100M": 4,
    "$100M+": 4,
  };
  const acvModMap = {
    "Under $10K": 0,
    "$10–25K": 1,
    "$25–75K": 2,
    "$75–250K": 3,
    "$250K+": 4,
  };

  const revenueMod = revenueModMap[inputs.annual_revenue] ?? 0;
  const acvMod = acvModMap[inputs.acv] ?? 0;

  pillar_scores.gtm_focus += revenueMod;
  pillar_scores.measurement += revenueMod;
  pillar_scores.value_architecture += acvMod;
  pillar_scores.pricing_packaging += acvMod;

  // 1) Positioning & Category
  const winMap = {
    "Clear differentiation": 6,
    "Brand trust": 5,
    "Feature depth": 4,
    "Speed / Ease of Use": 4,
    "Strong relationships": 2,
    "Lowest price": 1,
  };
  const loseMap = {
    "Lack of differentiation": 1,
    "Unclear ROI": 2,
    "Brand trust": 2,
    "Procurement friction": 3,
    "Feature gaps": 4,
    "Price": 5,
  };
  const consistencyMap = {
    "Yes — very consistent": 8,
    "Somewhat": 5,
    "Often unclear": 2,
  };

  pillar_scores.positioning += winMap[inputs.win_reason] ?? 0;
  pillar_scores.positioning += loseMap[inputs.lose_reason] ?? 0;
  pillar_scores.positioning += consistencyMap[inputs.consistency] ?? 0;
  pillar_scores.positioning = cap(pillar_scores.positioning, 20);

  // 2) Value Architecture
  const roiMap = {
    "Yes — documented & repeatable": 8,
    "Somewhat": 5,
    "No": 2,
  };
  const leadWithMap = {
    "Financial ROI": 6,
    "Business outcomes": 5,
    "Technical differentiation": 4,
    "Features": 2,
  };
  const metricsMap = {
    "Revenue growth": 6,
    "Margin expansion": 6,
    "Cost reduction": 5,
    "Risk reduction": 4,
    "Productivity gains": 4,
    "Not clearly defined": 1,
  };

  pillar_scores.value_architecture += roiMap[inputs.roi_quantifiable] ?? 0;
  pillar_scores.value_architecture += leadWithMap[inputs.sales_lead_with] ?? 0;
  pillar_scores.value_architecture += metricsMap[inputs.financial_metrics_improved] ?? 0;
  pillar_scores.value_architecture = cap(pillar_scores.value_architecture, 20);

  // 3) Pricing & Packaging
  const discountMap = {
    "Rarely (<10%)": 8,
    "Sometimes (10–40%)": 5,
    "Frequently (40%+)": 2,
  };
  const tierClarityMap = {
    "Yes — very clear": 6,
    "Somewhat": 4,
    "Often confused": 2,
  };
  const marginMap = {
    "75%+": 6,
    "65–75%": 5,
    "50–65%": 4,
    "Under 50%": 2,
  };

  pillar_scores.pricing_packaging += discountMap[inputs.discount_frequency] ?? 0;
  pillar_scores.pricing_packaging += tierClarityMap[inputs.pricing_tiers_clarity] ?? 0;
  pillar_scores.pricing_packaging += marginMap[inputs.gross_margin] ?? 0;
  pillar_scores.pricing_packaging = cap(pillar_scores.pricing_packaging, 20);

  // 4) GTM Focus
  const channelPoints = {
    Partnerships: 3,
    Content: 3,
    "Product-led": 3,
    "Outbound SDR": 2,
    "Founder-led selling": 2,
    Events: 2,
    "Paid search": 1,
    "Paid social": 1,
  };

  const salesCycleMap = {
    "Under 1 month": 6,
    "1–3 months": 5,
    "3–6 months": 4,
    "6–12 months": 3,
    "12+ months": 2,
  };
  const closeRateMap = {
    "40%+": 6,
    "25–40%": 5,
    "15–25%": 4,
    "Under 15%": 2,
  };

  const channels = Array.isArray(inputs.acquisition_channels)
    ? inputs.acquisition_channels
    : [];
  const channelScoreRaw = channels
    .slice(0, 3)
    .reduce((sum, ch) => sum + (channelPoints[ch] ?? 0), 0);

  pillar_scores.gtm_focus += cap(channelScoreRaw, 8);
  pillar_scores.gtm_focus += salesCycleMap[inputs.sales_cycle] ?? 0;
  pillar_scores.gtm_focus += closeRateMap[inputs.close_rate] ?? 0;
  pillar_scores.gtm_focus = cap(pillar_scores.gtm_focus, 20);

  // 5) Measurement
  const measuredByMap = {
    Revenue: 6,
    Pipeline: 5,
    "Brand metrics": 3,
    Leads: 2,
  };
  const attributionMap = {
    Yes: 8,
    Debated: 5,
    No: 2,
  };
  const forecastMap = {
    Yes: 6,
    No: 2,
  };
  const cacMap = {
    Yes: 6,
    "Rough estimates": 4,
    No: 2,
  };

  pillar_scores.measurement += measuredByMap[inputs.marketing_measured_by] ?? 0;
  pillar_scores.measurement += attributionMap[inputs.attribution_trusted] ?? 0;
  pillar_scores.measurement += forecastMap[inputs.forecast_accuracy] ?? 0;
  pillar_scores.measurement += cacMap[inputs.cac_by_channel] ?? 0;
  pillar_scores.measurement = cap(pillar_scores.measurement, 20);

  const brand_to_gtm_os_score =
    pillar_scores.positioning +
    pillar_scores.value_architecture +
    pillar_scores.pricing_packaging +
    pillar_scores.gtm_focus +
    pillar_scores.measurement;

  // primary constraint = lowest pillar
  const primary_constraint_key = Object.keys(pillar_scores).sort(
    (a, b) => pillar_scores[a] - pillar_scores[b]
  )[0];

  return {
    brand_to_gtm_os_score,
    interpretation_band: scoreBand(brand_to_gtm_os_score),
    pillar_scores,
    primary_constraint_key,
  };
}

/* =========================================================
   Legacy Scoring (existing)
========================================================= */

const LEGACY_SCORING_VERSION = "legacy_v1";

function getConfig() {
  return {
    version: LEGACY_SCORING_VERSION,
    pillar_base_score: 3,
    pillar_min: 0,
    pillar_max: 5,
    score_rules: {
      positioning: [
        {
          if: { "Why do you most often win deals?": "Lowest price" },
          delta: -2,
          flag: "Price-led wins suggest commoditization risk.",
        },
        {
          if: { "Why do you most often lose deals?": "Price" },
          delta: -2,
          flag: "Pricing pressure indicates weak value anchoring.",
        },
        {
          if: { "Why do you most often lose deals?": "Lack of differentiation" },
          delta: -2,
          flag: "Differentiation gap in competitive deals.",
        },
        {
          if: { "Do customers describe your company consistently?": "Often unclear" },
          delta: -2,
          flag: "Positioning clarity issue.",
        },
        { if: { "Why do you most often win deals?": "Clear differentiation" }, delta: 2 },
        { if: { "Why do you most often win deals?": "Brand trust" }, delta: 1 },
      ],
      value_architecture: [
        {
          if: { "Can you quantify ROI for most customers?": "Yes — documented & repeatable" },
          delta: 3,
        },
        {
          if: { "Can you quantify ROI for most customers?": "No" },
          delta: -3,
          flag: "ROI not clearly quantified.",
        },
        {
          if: { "Sales conversations primarily lead with:": "Features" },
          delta: -2,
          flag: "Feature-led selling limits pricing power.",
        },
        { if: { "Sales conversations primarily lead with:": "Financial ROI" }, delta: 2 },
        {
          if: {
            "What financial metrics do customers see improve due to your product?":
              "Not clearly defined",
          },
          delta: -2,
          flag: "Economic value not clearly anchored to metrics.",
        },
      ],
      pricing_packaging: [
        {
          if: { "How often are discounts required to close deals?": "Frequently (40%+)" },
          delta: -3,
          flag: "Frequent discounting compresses margin.",
        },
        { if: { "How often are discounts required to close deals?": "Sometimes (10–40%)" }, delta: -1 },
        {
          if: { "Do customers clearly understand your pricing tiers?": "Often confused" },
          delta: -2,
          flag: "Pricing structure may be unclear.",
        },
        { if: { "What is your gross margin (%)?": "Under 50%" }, delta: -2 },
        { if: { "What is your gross margin (%)?": "75%+" }, delta: 2 },
      ],
      gtm_focus: [
        { if: { "Do you know CAC by channel?": "No" }, delta: -2, flag: "Channel economics unclear." },
        { if: { "How would you rate your growth status?": "Stalled" }, delta: -2, flag: "Growth stall indicator." },
        { if: { "How would you rate your growth status?": "Plateauing" }, delta: -1 },
      ],
      measurement: [
        {
          if: { "Marketing is measured primarily by:": "Leads" },
          delta: -2,
          flag: "Lead-focused measurement may signal vanity metrics.",
        },
        { if: { "Marketing is measured primarily by:": "Revenue" }, delta: 2 },
        { if: { "Is attribution trusted internally?": "No" }, delta: -2, flag: "Attribution credibility gap." },
        { if: { "Are revenue forecasts accurate within 10%": "No" }, delta: -2, flag: "Forecast reliability risk." },
      ],
    },
    alignment_bands: [
      { min: 24, max: 30, label: "Structurally Aligned" },
      { min: 18, max: 23, label: "Operational Friction" },
      { min: 12, max: 17, label: "Strategic Leakage" },
      { min: 0, max: 11, label: "Structural Misalignment" },
    ],
  };
}

function normalizeKey(str) {
  return String(str || "").trim().toLowerCase().replace(/[?!.]+$/, "");
}

function normalizeValue(str) {
  return String(str || "").trim().toLowerCase().replace(/[?!.]+$/, "");
}

function buildNormalizedLookup(answers) {
  const lookup = {};
  for (const [k, v] of Object.entries(answers)) {
    lookup[normalizeKey(k)] = v;
  }
  return lookup;
}

function scoreLegacy(answers, config) {
  const base = config.pillar_base_score;
  const normalizedLookup = buildNormalizedLookup(answers);

  const pillars = {
    positioning: base,
    value_architecture: base,
    pricing_packaging: base,
    gtm_focus: base,
    measurement: base,
  };

  const flags = [];

  for (const pillar of Object.keys(config.score_rules)) {
    for (const rule of config.score_rules[pillar]) {
      const field = Object.keys(rule.if)[0];
      const expected = rule.if[field];

      const rawAnswer = field in answers ? answers[field] : normalizedLookup[normalizeKey(field)];
      if (normalizeValue(rawAnswer) === normalizeValue(expected)) {
        pillars[pillar] += rule.delta;
        if (rule.flag) flags.push(rule.flag);
      }
    }
  }

  for (const p of Object.keys(pillars)) {
    pillars[p] = Math.max(config.pillar_min, Math.min(config.pillar_max, pillars[p]));
  }

  const total = Object.values(pillars).reduce((a, b) => a + b, 0);
  const band =
    config.alignment_bands.find((b) => total >= b.min && total <= b.max)?.label || "Unknown";

  const primaryConstraint = Object.keys(pillars).sort((a, b) => pillars[a] - pillars[b])[0];

  return { total, band, pillars, primaryConstraint, flags };
}

/* =========================================================
   Email Copy (OS-first)
========================================================= */

function renderExecSummary({ osScored, clientName }) {
  const niceConstraint = prettyPillar(osScored.primary_constraint_key);

  const bodyText = `Hi ${clientName || "there"},

Your Brand-to-GTM OS Executive Summary is ready.

OS alignment: ${osScored.interpretation_band} (Score: ${osScored.brand_to_gtm_os_score}/100)
Primary constraint: ${niceConstraint}

Next step:
Reply to this email or book your 30-minute intro call to walk through the summary.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Executive Summary", bodyText };
}

function renderAudit({ osScored, clientName }) {
  const bodyText = `Hi ${clientName || "there"},

Your Brand-to-GTM OS Strategic Audit is ready.

OS alignment: ${osScored.interpretation_band} (Score: ${osScored.brand_to_gtm_os_score}/100)

OS pillar scores (0–20):
- Positioning & Category: ${osScored.pillar_scores.positioning}
- Value Architecture: ${osScored.pillar_scores.value_architecture}
- Pricing & Packaging: ${osScored.pillar_scores.pricing_packaging}
- GTM Focus: ${osScored.pillar_scores.gtm_focus}
- Measurement: ${osScored.pillar_scores.measurement}

Primary constraint:
- ${prettyPillar(osScored.primary_constraint_key)}

Reply to confirm your 60-minute review session time.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Strategic Audit", bodyText };
}

function renderInsufficientDataEmail({ clientName }) {
  const subject = "Your Brand-to-GTM OS Executive Summary";
  const bodyText = `Hi ${clientName || "there"},

Thanks — I received your submission, but there isn’t enough data yet to generate a reliable OS score.

Next step:
Reply with a bit more detail (or resubmit the form) so I can produce an accurate summary.

— Jasper
`;
  return { subject, bodyText };
}

/* =========================================================
   Report Builder (OS-first; legacy kept but not headline)
========================================================= */

function buildReport({ tier, clientName, clientEmail, answers, osScored, legacyScored, content }) {
  const generatedAt = new Date().toISOString();
  const na = normalizeAnswers(answers);

  const baseReport = {
    schema_version: "1.0",
    generated_at: generatedAt,
    tier,
    client: {
      company_name: null,
      contact_name: clientName || null,
      contact_email: clientEmail || "",
      website: null,
    },
    inputs: {
      source: "honeybook",
      raw_answers: answers,
      normalized_answers: na,
    },

    scoring: {
      // ✅ Versioning
      os_scoring_version: OS_SCORING_VERSION,

      // ✅ OS headline
      overall_score: osScored.brand_to_gtm_os_score,
      overall_max: 100,
      band: osScored.interpretation_band,
      primary_constraint: {
        key: osScored.primary_constraint_key,
        label: prettyPillar(osScored.primary_constraint_key),
        why_it_matters:
          "This pillar most constrains performance across brand clarity, pricing power, and go-to-market execution.",
        symptoms: [],
        downstream_impacts: [
          "Lower win rates in competitive deals",
          "Discounting pressure and margin compression",
          "Inconsistent messaging and weak differentiation",
        ],
      },
      pillar_scores: [
        { key: "positioning", label: "Positioning & Category", score: osScored.pillar_scores.positioning, max: 20 },
        { key: "value_architecture", label: "Value Architecture", score: osScored.pillar_scores.value_architecture, max: 20 },
        { key: "pricing_packaging", label: "Pricing & Packaging", score: osScored.pillar_scores.pricing_packaging, max: 20 },
        { key: "gtm_focus", label: "GTM Focus", score: osScored.pillar_scores.gtm_focus, max: 20 },
        { key: "measurement", label: "Measurement", score: osScored.pillar_scores.measurement, max: 20 },
      ],

      // ✅ Legacy kept (not headline)
      legacy: {
        legacy_scoring_version: LEGACY_SCORING_VERSION,
        overall_score: legacyScored.total,
        overall_max: 25,
        band: legacyScored.band,
        primary_constraint: legacyScored.primaryConstraint,
        pillar_scores: legacyScored.pillars,
        flags: legacyScored.flags || [],
      },
    },

    narrative: {
      executive_summary: {
        headline: `${osScored.interpretation_band}: primary constraint is ${prettyPillar(
          osScored.primary_constraint_key
        )}`,
        summary_paragraph:
          "This diagnostic reflects alignment across five pillars of the Brand-to-GTM Operating System. The goal is to identify the constraint that, if improved, will unlock the most leverage.",
        key_observations: [],
        what_to_do_next: [
          "Confirm the primary constraint with a short review call",
          "Prioritize 1–2 quick wins to improve clarity and commercial outcomes",
          "Decide if a full Strategic Audit is warranted",
        ],
      },
      pillar_interpretations: [
        {
          pillar_key: osScored.primary_constraint_key,
          interpretation:
            "Your lowest-scoring pillar is likely creating downstream friction across differentiation, pricing power, and GTM efficiency.",
          quick_wins: [
            "Define a sharper category POV and differentiation claim",
            "Anchor value in measurable outcomes (economic proof)",
            "Reduce discounting by tightening packaging and guardrails",
          ],
          questions_to_answer: [
            "What do we win on besides price?",
            "Which customer outcomes are repeatable and provable?",
            "What is the simplest packaging structure customers understand quickly?",
          ],
        },
      ],
    },

    deliverables: {
      email: {
        subject: content.subject,
        body_text: content.bodyText,
        body_html: null,
      },
      pdf: {
        title: tier === "audit" ? "Brand-to-GTM OS Strategic Audit" : "Brand-to-GTM OS Executive Summary",
        pdf_url: null,
        html_url: null,
        pages_estimate: tier === "audit" ? 10 : 3,
      },
    },

    disclaimer: {
      ai_assisted: false,
      limitations: [
        "This diagnostic is based on provided inputs and deterministic scoring rules.",
        "Competitive analysis and pricing insights (when present) should be validated with market research.",
      ],
    },
  };

  if (tier === "audit") {
    baseReport.full_tier = buildFullTierPlaceholder({ answers });
  } else {
    baseReport.exec_tier = buildExecTierUpsell();
  }

  return baseReport;
}

function buildExecTierUpsell() {
  return {
    top_moves_30_days: [
      {
        title: "Clarify positioning in one sentence",
        why: "Positioning clarity reduces sales friction and improves pricing power.",
        how: [
          "Write a category POV + differentiation claim",
          "Validate with 3 customer calls",
          "Align homepage + pitch deck messaging",
        ],
        expected_impact: "Improved consistency in sales conversations and competitive win rates.",
        effort: "low",
      },
      {
        title: "Quantify value with 2–3 proof points",
        why: "Economic proof reduces discounting and speeds deal cycles.",
        how: [
          "Identify top 2 metrics customers care about",
          "Build 1-page ROI story template",
          "Instrument one customer case quickly",
        ],
        expected_impact: "Higher close rate with fewer concessions.",
        effort: "medium",
      },
      {
        title: "Tighten pricing guardrails",
        why: "Discounting often signals weak packaging and unclear value anchors.",
        how: [
          "Define discount thresholds",
          "Standardize approval workflow",
          "Improve tier naming and feature/value ladders",
        ],
        expected_impact: "Better margin stability and improved deal discipline.",
        effort: "medium",
      },
    ],
    upgrade_positioning: {
      headline: "What the Full Strategic Audit Unlocks",
      value_bullets: [
        "A pillar-by-pillar diagnosis with specific root-cause hypotheses",
        "SWOT tied directly to Brand-to-GTM levers",
        "Competitive pricing & packaging audit (hypotheses + what-to-verify)",
        "A prioritized 30/90-day roadmap + first sprint plan",
      ],
      offer: { name: "Full Strategic Audit", price_usd: 499, cta_label: "Upgrade to Full Audit", cta_url: null },
    },
  };
}

function buildFullTierPlaceholder({ answers }) {
  return {
    swot: {
      strengths: [{ point: "Strength placeholder", evidence: [] }],
      weaknesses: [{ point: "Weakness placeholder", evidence: [] }],
      opportunities: [{ point: "Opportunity placeholder", evidence: [] }],
      threats: [{ point: "Threat placeholder", evidence: [] }],
    },
    competitive_context: {
      category: answers["What category do you compete in?"] || null,
      most_compared_to: answers["Who do customers compare you to most often?"]
        ? [answers["Who do customers compare you to most often?"]]
        : [],
      competitive_archetypes: [],
      positioning_hypotheses: [],
    },
    pricing_packaging_audit: {
      current_state_signals: [],
      pricing_power_risks: [],
      discounting_diagnosis: "",
      packaging_issues: [],
      hypotheses_to_test: [],
      what_to_validate: [],
      first_fixes: [],
    },
    roadmap: {
      north_star:
        "Establish clear positioning and value proof to reduce discounting and improve GTM efficiency.",
      principles: ["Clarity over breadth", "Proof over promises", "Focus over fragmentation"],
      thirty_day: [],
      ninety_day: [],
      six_to_twelve_month: [],
    },
    first_sprint_plan: { weeks: [] },
    appendix: {
      response_summary: Object.entries(answers).map(([question, answer]) => ({
        question,
        answer: Array.isArray(answer) ? answer.join(", ") : String(answer ?? ""),
        notes: null,
      })),
    },
  };
}

/* =========================================================
   LLM Enrichment (audit tier only, feature flag)
========================================================= */

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validateAuditEnrichment(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!obj.full_tier || typeof obj.full_tier !== "object") return false;
  if (!obj.full_tier.swot) return false;
  if (!obj.full_tier.roadmap) return false;
  return true;
}

async function enrichAuditReport(report) {
  const client = getOpenAIClient();
  const model = process.env.LLM_MODEL || "gpt-5";

  const compactInput = {
    tier: report.tier,
    scoring: report.scoring,
    normalized_answers: report.inputs?.normalized_answers,
  };

  const systemPrompt =
    "You are a senior B2B brand and go-to-market strategist. Return ONLY valid JSON. No markdown. No commentary. Do not fabricate market data. Use hypotheses when information is missing.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this shape:

{
  "narrative": { "text": "..." },
  "full_tier": {
    "swot": {
      "strengths": [{"point":"","evidence":[]}],
      "weaknesses": [{"point":"","evidence":[]}],
      "opportunities": [{"point":"","evidence":[]}],
      "threats": [{"point":"","evidence":[]}]
    },
    "competitive_context": {
      "category": null,
      "most_compared_to": [],
      "competitive_archetypes": [],
      "positioning_hypotheses": []
    },
    "pricing_packaging_audit": {
      "current_state_signals": [],
      "pricing_power_risks": [],
      "discounting_diagnosis": "",
      "packaging_issues": [],
      "hypotheses_to_test": [],
      "what_to_validate": [],
      "first_fixes": []
    },
    "roadmap": {
      "north_star": "",
      "principles": [],
      "thirty_day": [],
      "ninety_day": [],
      "six_to_twelve_month": []
    }
  }
}

Diagnostic data:
${JSON.stringify(compactInput)}
`.trim();

  const response = await client.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.output_text || "";
  const parsed = safeJsonParse(text);

  if (!validateAuditEnrichment(parsed)) {
    throw new Error("Invalid LLM enrichment output");
  }

  return parsed;
}

/* =========================================================
   Auth helper (x-vw-token OR Authorization: Bearer)
========================================================= */

function extractAuthToken(req) {
  const headerToken = req.headers["x-vw-token"];
  if (headerToken) return String(headerToken).trim();

  const auth = req.headers["authorization"] || req.headers["Authorization"];
  if (!auth) return null;

  const s = String(auth).trim();
  const m = s.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1].trim();

  return null;
}

/* =========================================================
   Insufficient data guard (Option 2)
========================================================= */

const MIN_REQUIRED_FIELDS = 9;

// Fields that actually drive OS scoring.
const OS_REQUIRED_KEYS = [
  "annual_revenue",
  "acv",
  "sales_cycle",
  "close_rate",
  "win_reason",
  "lose_reason",
  "consistency",
  "roi_quantifiable",
  "sales_lead_with",
  "discount_frequency",
  "pricing_tiers_clarity",
  "gross_margin",
  "acquisition_channels",
  "marketing_measured_by",
  "attribution_trusted",
  "forecast_accuracy",
  "cac_by_channel",
];

function countPresentRequired(osInputs) {
  const present = [];
  const missing = [];

  for (const k of OS_REQUIRED_KEYS) {
    const v = osInputs[k];
    const isPresent = Array.isArray(v)
      ? v.length > 0
      : v !== null && v !== undefined && String(v).trim() !== "";

    if (isPresent) present.push(k);
    else missing.push(k);
  }

  return { presentCount: present.length, presentKeys: present, missingKeys: missing };
}

/* =========================================================
   Handler
========================================================= */

export default async function handler(req, res) {
  const L = createDiagLogger(req);
  L.start();

  try {
    if (req.method !== "POST") {
      L.finish(405);
      return res.status(405).json({ error: "POST only" });
    }

    // Auth
    const token = extractAuthToken(req);
    if (!token || token !== process.env.VW_TOKEN) {
      L.finish(401);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = req.body || {};
    const rawAnswers = payload.answers;

    // Validate answers
    if (
      rawAnswers === undefined ||
      rawAnswers === null ||
      typeof rawAnswers !== "object" ||
      Array.isArray(rawAnswers) ||
      Object.keys(rawAnswers).length === 0
    ) {
      L.finish(400);
      return res
        .status(400)
        .json({ error: "Invalid payload: 'answers' must be a non-empty object." });
    }

    // Defensive normalize answers (trim strings, ""->null, arrays cleaned)
    const answers = normalizeIncomingAnswers(rawAnswers);

    // Tier
    let tier = payload.tier || "exec"; // "exec" | "audit"
    if (tier === "full") tier = "audit";

    const clientEmail = cleanScalar(payload.client_email) || "";
    const clientName = cleanScalar(payload.client_name) || "";

    // ---- Legacy scoring (kept) ----
    const tLegacy = L.mark();
    const config = getConfig();
    const legacyScored = scoreLegacy(answers, config);
    L.step("scoreLegacy", tLegacy, { total: legacyScored.total, band: legacyScored.band });

    // ---- OS scoring inputs ----
    const tOS = L.mark();
    const na = normalizeAnswers(answers);

    const osInputs = {
      annual_revenue: na.annual_revenue,
      acv: na.acv,
      sales_cycle: na.sales_cycle,
      close_rate: na.close_rate,

      win_reason: na.win_reason,
      lose_reason: na.lose_reason,
      consistency: na.positioning_consistency,

      roi_quantifiable: na.roi_repeatable,
      sales_lead_with: na.sales_lead,
      financial_metrics_improved: na.financial_metrics_improved,

      discount_frequency: na.discounting,
      pricing_tiers_clarity: na.pricing_clarity,
      gross_margin: na.gross_margin,

      acquisition_channels: normalizeChannels(na.acquisition_channels),
      cac_by_channel: na.cac_by_channel,

      marketing_measured_by: na.marketing_measured_by,
      attribution_trusted: na.attribution_trusted,
      forecast_accuracy: na.forecast_accuracy,
    };

    // ---- Insufficient data guard (Option 2) ----
    const { presentCount, missingKeys } = countPresentRequired(osInputs);

    if (presentCount < MIN_REQUIRED_FIELDS) {
      const tRender = L.mark();
      const content = renderInsufficientDataEmail({ clientName });
      L.step("render_insufficient", tRender, { presentCount, missing: missingKeys.length });

      const generatedAt = new Date().toISOString();

      const report = {
        schema_version: "1.0",
        generated_at: generatedAt,
        tier,
        client: {
          company_name: null,
          contact_name: clientName || null,
          contact_email: clientEmail || "",
          website: null,
        },
        inputs: {
          source: "honeybook",
          raw_answers: answers,
          normalized_answers: na,
        },
        scoring: {
          os_scoring_version: OS_SCORING_VERSION,

          insufficient_data: true,
          required_min: MIN_REQUIRED_FIELDS,
          present_required_count: presentCount,
          missing_required_fields: missingKeys,

          overall_score: null,
          overall_max: 100,
          band: "Insufficient data",
          primary_constraint: null,
          pillar_scores: [],

          legacy: {
            legacy_scoring_version: LEGACY_SCORING_VERSION,
            overall_score: legacyScored.total,
            overall_max: 25,
            band: legacyScored.band,
            primary_constraint: legacyScored.primaryConstraint,
            pillar_scores: legacyScored.pillars,
            flags: legacyScored.flags || [],
          },
        },
        narrative: {
          executive_summary: {
            headline: "Insufficient data to score reliably",
            summary_paragraph:
              "We received your submission, but not enough inputs were provided to generate a reliable Brand-to-GTM OS score.",
            key_observations: [],
            what_to_do_next: [
              "Resubmit with additional answers",
              "Or reply to this email and I’ll ask 3–5 quick follow-ups",
            ],
          },
          pillar_interpretations: [],
        },
        deliverables: {
          email: { subject: content.subject, body_text: content.bodyText, body_html: null },
          pdf: {
            title: "Brand-to-GTM OS Executive Summary",
            pdf_url: null,
            html_url: null,
            pages_estimate: 1,
          },
        },
        disclaimer: {
          ai_assisted: false,
          limitations: ["This diagnostic requires a minimum set of inputs to produce a reliable score."],
        },
      };

      const summary = {
        score: null,
        band: "Insufficient data",
        primary_constraint: null,
        primary_constraint_label: null,
        insufficient_data: true,
        present_required_count: presentCount,
        required_min: MIN_REQUIRED_FIELDS,
        missing_required_fields: missingKeys,
      };

      const includeReportJson = process.env.INCLUDE_REPORT_JSON === "1";

      L.finish(200);
      return res.status(200).json({
        report,
        ...(includeReportJson ? { report_json: JSON.stringify(report) } : {}),

        // Explicit OS fields
        brand_to_gtm_os_score: null,
        brand_to_gtm_os_band: "Insufficient data",
        brand_to_gtm_os_pillar_scores: {},
        brand_to_gtm_os_primary_constraint: null,
        brand_to_gtm_os_primary_constraint_label: null,

        // Zapier-friendly summary
        summary,

        // Backward compatible keys (now point to OS headline; null here)
        tier,
        overall_score: null,
        band: "Insufficient data",
        primary_constraint: null,

        // Email fields
        email_subject: content.subject,
        email_body_text: content.bodyText,
        client_email: clientEmail,
      });
    }

    // ---- Compute OS score ----
    const osScored = computeBrandToGtmOsScore(osInputs);
    L.step("scoreOS", tOS, { total: osScored.brand_to_gtm_os_score, band: osScored.interpretation_band });

    // Email content (OS-first)
    const tRender = L.mark();
    const content =
      tier === "audit"
        ? renderAudit({ osScored, clientName })
        : renderExecSummary({ osScored, clientName });
    L.step("render", tRender);

    // Report (OS-first + legacy tucked inside)
    const tBuild = L.mark();
    const report = buildReport({
      tier,
      clientName,
      clientEmail,
      answers,
      osScored,
      legacyScored,
      content,
    });

    // Add insufficient-data transparency fields (false here) for consistency
    report.scoring.insufficient_data = false;
    report.scoring.required_min = MIN_REQUIRED_FIELDS;
    report.scoring.present_required_count = presentCount;
    report.scoring.missing_required_fields = [];

    L.step("buildReport", tBuild);

    // Optional LLM enrichment (audit only)
    const llmEnabled = process.env.LLM_ENRICH === "1";
    const llmModel = process.env.LLM_MODEL || "gpt-5";

    if (llmEnabled && tier === "audit") {
      const tEnrich = L.mark();
      try {
        L.log(`LLM enrichment START model=${llmModel}`);
        const enriched = await enrichAuditReport(report);

        L.step("enrichAuditReport OK", tEnrich, {
          has_full_tier: !!enriched?.full_tier,
          has_narrative: !!enriched?.narrative,
        });

        if (enriched?.full_tier) report.full_tier = enriched.full_tier;
        if (enriched?.narrative) report.narrative = enriched.narrative;
        if (report?.disclaimer) report.disclaimer.ai_assisted = true;
      } catch (err) {
        L.step("enrichAuditReport FAIL", tEnrich, {
          message: err?.message,
          name: err?.name,
          status: err?.status,
          code: err?.code,
          type: err?.type,
        });
        console.error("[diag] LLM enrichment failed:", err);
      }
    }

    const summary = {
      score: osScored.brand_to_gtm_os_score,
      band: osScored.interpretation_band,
      primary_constraint: osScored.primary_constraint_key,
      primary_constraint_label: prettyPillar(osScored.primary_constraint_key),
      insufficient_data: false,
      present_required_count: presentCount,
      required_min: MIN_REQUIRED_FIELDS,
      missing_required_fields: [],
    };

    const includeReportJson = process.env.INCLUDE_REPORT_JSON === "1";

    L.finish(200);

    // OS-first top-level response
    return res.status(200).json({
      report,
      ...(includeReportJson ? { report_json: JSON.stringify(report) } : {}),

      // Explicit OS fields (new)
      brand_to_gtm_os_score: osScored.brand_to_gtm_os_score,
      brand_to_gtm_os_band: osScored.interpretation_band,
      brand_to_gtm_os_pillar_scores: osScored.pillar_scores,
      brand_to_gtm_os_primary_constraint: osScored.primary_constraint_key,
      brand_to_gtm_os_primary_constraint_label: prettyPillar(osScored.primary_constraint_key),

      // Zapier-friendly summary
      summary,

      // Backward compatible keys (now point to OS headline)
      tier,
      overall_score: osScored.brand_to_gtm_os_score,
      band: osScored.interpretation_band,
      primary_constraint: osScored.primary_constraint_key,

      // Email fields
      email_subject: content.subject,
      email_body_text: content.bodyText,
      client_email: clientEmail,
    });
  } catch (err) {
    L.error("Unhandled error", { message: err?.message, name: err?.name });
    L.finish(500);
    console.error("[diag] Unhandled error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}