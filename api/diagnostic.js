// api/diagnostic.js
// Drop-in replacement.
// - Keeps existing Zapier flat fields (tier, overall_score, email_subject, etc.)
// - Adds: report (object) + report_json (string)
// - Adds payload validation (400 if answers missing / not object / empty)
// - Adds answer-key normalization (minor punctuation/case differences won't break scoring)
// - Adds optional audit-tier LLM enrichment behind feature flag (LLM_ENRICH=1)
// - Adds Brand-to-GTM OS Score (0–100) alongside existing 0–25 scoring

import OpenAI from "openai";
import { createDiagLogger } from "../lib/diagLogger.js";

/* =========================================================
   Brand-to-GTM OS Score (v1.0) — 0 to 100
   5 pillars x 20 points = 100
   Deterministic (no AI needed)
========================================================= */

function cap(n, max) {
  return Math.max(0, Math.min(n, max));
}

function scoreBand(totalScore) {
  if (totalScore >= 80) return "High Brand-to-GTM alignment";
  if (totalScore >= 65) return "Moderate system friction";
  if (totalScore >= 50) return "Structural GTM misalignment";
  return "Severe growth constraints";
}

// Helper: ensures acquisition channels are always an array
function normalizeChannels(val) {
  if (Array.isArray(val)) return val;

  // If HoneyBook/Zapier sends a comma-separated or newline string
  if (typeof val === "string") {
    return val
      .split(/,|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * computeBrandToGtmOsScore expects stable keys (adapter below provides these)
 */
function computeBrandToGtmOsScore(answers) {
  const pillar_scores = {
    positioning: 0,
    value_architecture: 0,
    pricing_packaging: 0,
    gtm_focus: 0,
    measurement: 0,
  };

  // --- Optional firmographic modifiers (light influence) ---
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

  const revenueMod = revenueModMap[answers.annual_revenue] ?? 0;
  const acvMod = acvModMap[answers.acv] ?? 0;

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

  pillar_scores.positioning += winMap[answers.win_reason] ?? 0;
  pillar_scores.positioning += loseMap[answers.lose_reason] ?? 0;
  pillar_scores.positioning += consistencyMap[answers.consistency] ?? 0;
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

  pillar_scores.value_architecture += roiMap[answers.roi_quantifiable] ?? 0;
  pillar_scores.value_architecture += leadWithMap[answers.sales_lead_with] ?? 0;
  pillar_scores.value_architecture += metricsMap[answers.financial_metrics_improved] ?? 0;
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

  pillar_scores.pricing_packaging += discountMap[answers.discount_frequency] ?? 0;
  pillar_scores.pricing_packaging += tierClarityMap[answers.pricing_tiers_clarity] ?? 0;
  pillar_scores.pricing_packaging += marginMap[answers.gross_margin] ?? 0;
  pillar_scores.pricing_packaging = cap(pillar_scores.pricing_packaging, 20);

  // 4) GTM Focus
  const channelPoints = {
    "Partnerships": 3,
    "Content": 3,
    "Product-led": 3,
    "Outbound SDR": 2,
    "Founder-led selling": 2,
    "Events": 2,
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

  const channels = Array.isArray(answers.acquisition_channels) ? answers.acquisition_channels : [];
  const channelScoreRaw = channels
    .slice(0, 3)
    .reduce((sum, ch) => sum + (channelPoints[ch] ?? 0), 0);

  const channelScore = cap(channelScoreRaw, 8);

  pillar_scores.gtm_focus += channelScore;
  pillar_scores.gtm_focus += salesCycleMap[answers.sales_cycle] ?? 0;
  pillar_scores.gtm_focus += closeRateMap[answers.close_rate] ?? 0;
  pillar_scores.gtm_focus = cap(pillar_scores.gtm_focus, 20);

  // 5) Measurement
  const measuredByMap = {
    "Revenue": 6,
    "Pipeline": 5,
    "Brand metrics": 3,
    "Leads": 2,
  };

  const attributionMap = {
    "Yes": 8,
    "Debated": 5,
    "No": 2,
  };

  const forecastMap = {
    "Yes": 6,
    "No": 2,
  };

  const cacMap = {
    "Yes": 6,
    "Rough estimates": 4,
    "No": 2,
  };

  pillar_scores.measurement += measuredByMap[answers.marketing_measured_by] ?? 0;
  pillar_scores.measurement += attributionMap[answers.attribution_trusted] ?? 0;
  pillar_scores.measurement += forecastMap[answers.forecast_accuracy] ?? 0;
  pillar_scores.measurement += cacMap[answers.cac_by_channel] ?? 0;
  pillar_scores.measurement = cap(pillar_scores.measurement, 20);

  const brand_to_gtm_os_score =
    pillar_scores.positioning +
    pillar_scores.value_architecture +
    pillar_scores.pricing_packaging +
    pillar_scores.gtm_focus +
    pillar_scores.measurement;

  return {
    brand_to_gtm_os_score,
    pillar_scores,
    interpretation_band: scoreBand(brand_to_gtm_os_score),
  };
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

    // Simple auth so random people can’t hit your endpoint
    const token = req.headers["x-vw-token"];
    if (!token || token !== process.env.VW_TOKEN) {
      L.finish(401);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = req.body || {};
    const answers = payload.answers;

    L.log("payload received", {
      tier: payload?.tier,
      answers_keys:
        answers && typeof answers === "object" && !Array.isArray(answers)
          ? Object.keys(answers).length
          : null,
    });

    // Validate answers
    if (
      answers === undefined ||
      answers === null ||
      typeof answers !== "object" ||
      Array.isArray(answers) ||
      Object.keys(answers).length === 0
    ) {
      L.finish(400);
      return res
        .status(400)
        .json({ error: "Invalid payload: 'answers' must be a non-empty object." });
    }

    // Tier normalization
    let tier = payload.tier || "exec"; // "exec" | "audit"
    if (tier === "full") tier = "audit";

    const clientEmail = payload.client_email || "";
    const clientName = payload.client_name || "";

    const tScore = L.mark();
    const config = getConfig();
    const scored = score(answers, config);
    L.step("score", tScore, { total: scored?.total, band: scored?.band });

    // === NEW: Brand-to-GTM OS Score (0–100) ===
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

    const osScored = computeBrandToGtmOsScore(osInputs);

    const tRender = L.mark();
    const content =
      tier === "audit"
        ? renderAudit({ scored, answers, clientName })
        : renderExecSummary({ scored, answers, clientName });
    L.step("render", tRender);

    const tBuild = L.mark();
    const report = buildReport({
      tier,
      clientName,
      clientEmail,
      answers,
      scored,
      config,
      content,
    });
    L.step("buildReport", tBuild);

    // ===== AUDIT LLM ENRICHMENT (Feature Flag Controlled) =====
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

        // Do NOT throw — keep server alive and return deterministic output.
        console.error("[diag] LLM enrichment failed (raw):", err);
        try {
          console.error(
            "[diag] LLM enrichment failed (stringified):",
            JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          );
        } catch (_) {}
      }
    }

    L.finish(200);

    // Backward-compatible response for existing Zapier mappings:
    return res.status(200).json({
      // ✅ new structured payload for PDF/LLM later
      report,
      report_json: JSON.stringify(report),

      // ✅ NEW: Brand-to-GTM OS Score (0–100 scale)
      brand_to_gtm_os_score: osScored?.brand_to_gtm_os_score ?? null,
      brand_to_gtm_os_band: osScored?.interpretation_band ?? null,
      brand_to_gtm_os_pillar_scores: osScored?.pillar_scores ?? null,

      // ✅ keep old keys for now (so you don’t break Zaps)
      tier,
      overall_score: scored.total,
      band: scored.band,
      primary_constraint: scored.primaryConstraint,
      pillar_scores: scored.pillars,
      flags: scored.flags,
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

/* =========================================================
   Report Builder (Schema v1.0)
========================================================= */

function buildReport({ tier, clientName, clientEmail, answers, scored, content }) {
  const generatedAt = new Date().toISOString();

  const pillarScoresArray = [
    pillarObj("positioning", scored.pillars.positioning),
    pillarObj("value_architecture", scored.pillars.value_architecture),
    pillarObj("pricing_packaging", scored.pillars.pricing_packaging),
    pillarObj("gtm_focus", scored.pillars.gtm_focus),
    pillarObj("measurement", scored.pillars.measurement),
  ];

  const primary = buildPrimaryConstraint(scored);

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
      normalized_answers: normalizeAnswers(answers),
    },
    scoring: {
      overall_score: scored.total,
      overall_max: 25,
      band: scored.band,
      primary_constraint: primary,
      pillar_scores: pillarScoresArray,
      flags: (scored.flags || []).map((f, i) => ({
        key: `flag_${i + 1}`,
        severity: "medium",
        title: f,
        evidence: [],
        recommendation: "",
      })),
    },
    narrative: buildNarrative({ scored }),
    deliverables: {
      email: {
        subject: content.subject,
        body_text: content.bodyText,
        body_html: null,
      },
      pdf: {
        title:
          tier === "audit"
            ? "Brand-to-GTM OS Strategic Audit"
            : "Brand-to-GTM OS Executive Summary",
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

function pillarObj(key, score) {
  return {
    key,
    label: prettyPillar(key),
    score,
    max: 5,
    band: score >= 4 ? "Strong" : score >= 3 ? "Mixed" : "At Risk",
    signals: [],
    risks: score <= 2 ? ["Pillar appears underdeveloped based on structured signals."] : [],
  };
}

function buildPrimaryConstraint(scored) {
  const key = scored.primaryConstraint;
  return {
    key,
    label: prettyPillar(key),
    why_it_matters:
      "This pillar most constrains performance across brand clarity, pricing power, and go-to-market execution.",
    symptoms: scored.flags?.length
      ? scored.flags.slice(0, 3)
      : ["No strong symptom flags detected from structured rules."],
    downstream_impacts: [
      "Lower win rates in competitive deals",
      "Discounting pressure and margin compression",
      "Inconsistent messaging and weak differentiation",
    ],
  };
}

function buildNarrative({ scored }) {
  const headline = `${scored.band}: primary constraint is ${prettyPillar(
    scored.primaryConstraint
  )}`;
  const observations =
    (scored.flags || []).length > 0
      ? scored.flags.slice(0, 4)
      : ["No major red flags detected from structured inputs."];

  return {
    executive_summary: {
      headline,
      summary_paragraph:
        "This diagnostic reflects alignment across five pillars of the Brand-to-GTM Operating System. The goal is to identify the constraint that, if improved, will unlock the most leverage.",
      key_observations: observations,
      what_to_do_next: [
        "Confirm the primary constraint with a short review call",
        "Prioritize 1–2 quick wins to improve clarity and commercial outcomes",
        "Decide if a full Strategic Audit is warranted",
      ],
    },
    pillar_interpretations: [
      {
        pillar_key: scored.primaryConstraint,
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
  };
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
        expected_impact:
          "Improved consistency in sales conversations and competitive win rates.",
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
      what_you_get: [
        "SWOT tied to Brand-to-GTM pillars",
        "Competitive pricing & packaging audit (hypotheses + validation plan)",
        "Prioritized 30/90-day roadmap with sprint plan",
      ],
      offer: {
        name: "Full Strategic Audit",
        price_usd: 499,
        cta_label: "Upgrade to Full Audit",
        cta_url: null,
      },
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
        answer: String(answer ?? ""),
        notes: null,
      })),
    },
  };
}

// Optional: map verbose question strings to stable keys for LLM use.
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
    positioning_consistency: answers["Do customers describe your company consistently?"] ?? null,

    roi_repeatable: answers["Can you quantify ROI for most customers?"] ?? null,
    sales_lead: answers["Sales conversations primarily lead with:"] ?? null,
    financial_metrics_improved:
      answers["What financial metrics do customers see improve due to your product?"] ?? null,

    discounting: answers["How often are discounts required to close deals?"] ?? null,
    pricing_clarity: answers["Do customers clearly understand your pricing tiers?"] ?? null,
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
   Existing Scoring + Copy (0–25) — keep for backward compat
========================================================= */

function getConfig() {
  return {
    version: "v1",
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
        { if: { "Marketing is measured primarily by:": "Leads" }, delta: -2, flag: "Lead-focused measurement may signal vanity metrics." },
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

function score(answers, config) {
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

  // Clamp
  for (const p of Object.keys(pillars)) {
    pillars[p] = Math.max(config.pillar_min, Math.min(config.pillar_max, pillars[p]));
  }

  const total = Object.values(pillars).reduce((a, b) => a + b, 0);
  const band =
    config.alignment_bands.find((b) => total >= b.min && total <= b.max)?.label || "Unknown";

  const primaryConstraint = Object.keys(pillars).sort((a, b) => pillars[a] - pillars[b])[0];

  return { total, band, pillars, primaryConstraint, flags };
}

function renderExecSummary({ scored, clientName }) {
  const nicePillar = prettyPillar(scored.primaryConstraint);
  const topFlags = (scored.flags || []).slice(0, 2);

  const bodyText = `Hi ${clientName || "there"},

Your Brand-to-GTM OS Executive Summary is ready.

Overall alignment: ${scored.band} (Score: ${scored.total}/25)
Primary constraint: ${nicePillar}

Key observations:
${
  topFlags.length
    ? topFlags.map((f) => `- ${f}`).join("\n")
    : "- No major red flags detected from the structured inputs."
}

Next step:
Reply to this email or book your 30-minute intro call to walk through the summary and learn more about the benefits of a full Brand-to-GTM OS diagnostic.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Executive Summary", bodyText };
}

function renderAudit({ scored, clientName }) {
  const bodyText = `Hi ${clientName || "there"},

Your Brand-to-GTM OS Strategic Audit is ready.

Alignment: ${scored.band} (Score: ${scored.total}/25)

Pillar scores (0–5):
- Positioning: ${scored.pillars.positioning}
- Value Architecture: ${scored.pillars.value_architecture}
- Pricing & Packaging: ${scored.pillars.pricing_packaging}
- GTM Focus: ${scored.pillars.gtm_focus}
- Measurement: ${scored.pillars.measurement}

Primary constraint:
- ${prettyPillar(scored.primaryConstraint)}

Risk flags:
${
  (scored.flags || []).length
    ? scored.flags.map((f) => `- ${f}`).join("\n")
    : "- None detected from structured rules."
}

Working hypotheses (v1):
- If your wins/losses are price-driven, strengthen economic value proof + differentiation narrative.
- If ROI is not repeatable, build a value architecture and case study system tied to measurable outcomes.
- If discounting is frequent, tighten packaging and value-based pricing anchors.

Recommended next steps:
1) Confirm ICP + buying trigger clarity (Positioning)
2) Convert outcomes to economic value (Value Architecture)
3) Rebuild packaging and pricing guardrails (Pricing)
4) Focus channels around one dominant motion (GTM)
5) Align metrics around pipeline velocity and revenue signal (Measurement)

Reply to confirm your 60-minute review session time.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Strategic Audit", bodyText };
}

function prettyPillar(key) {
  const map = {
    positioning: "Positioning & Category",
    value_architecture: "Value Architecture",
    pricing_packaging: "Pricing & Packaging",
    gtm_focus: "GTM Focus",
    measurement: "Measurement",
  };
  return map[key] || key;
}

/* =========================================================
   LLM Enrichment (Audit tier only)
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