// api/diagnostic.js
// Brand-to-GTM OS Diagnostic API
// Updated to use lib/scoring.js as the active scoring engine
// Keeps legacy scoring for internal comparison only

import OpenAI from "openai";
import { createDiagLogger } from "../lib/diagLogger.js";
import { makeReportId, saveReport } from "../lib/reportStore.js";
import { scoreDiagnostic } from "../lib/scoring.js";

/* =========================================================
   Helpers
========================================================= */

function cap(n, max) {
  return Math.max(0, Math.min(Number(n) || 0, max));
}

function scoreBand(totalScore) {
  if (totalScore >= 85) return "High Brand-to-GTM alignment";
  if (totalScore >= 70) return "Moderate system friction";
  if (totalScore >= 55) return "Structural GTM misalignment";
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

function pillarKeyFromLabel(label) {
  const map = {
    "Positioning & Category": "positioning",
    "Value Architecture": "value_architecture",
    "Pricing & Packaging": "pricing_packaging",
    "GTM Focus": "gtm_focus",
    "Measurement": "measurement",
  };
  return map[label] || "positioning";
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
  return v;
}

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

// Maps verbose question strings to stable keys
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
   OS Scoring Version
========================================================= */

const OS_SCORING_VERSION = "os_v2.0_consulting";

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
   Dynamic target scores
========================================================= */

function getDynamicTargetPillarScores(normalizedAnswers, tier = "exec") {
  const revenue = String(normalizedAnswers?.annual_revenue || "").toLowerCase();
  const acv = String(normalizedAnswers?.acv || "").toLowerCase();
  const cycle = String(normalizedAnswers?.sales_cycle || "").toLowerCase();
  const growth = String(normalizedAnswers?.growth_status || "").toLowerCase();
  const model = String(normalizedAnswers?.revenue_model || "").toLowerCase();

  // Target = minimum balanced-system threshold,
  // not aspirational perfection.

  let targets;

  const isEnterprise =
    revenue.includes("100m+") ||
    revenue.includes("$100m+") ||
    revenue.includes("50–100") ||
    revenue.includes("50-100") ||
    acv.includes("75–250") ||
    acv.includes("75-250") ||
    acv.includes("250k+");

  const isScaling =
    revenue.includes("25–50") ||
    revenue.includes("25-50") ||
    revenue.includes("10–25") ||
    revenue.includes("10-25") ||
    acv.includes("25–75") ||
    acv.includes("25-75");

  // Baseline thresholds by maturity stage
  if (isEnterprise) {
    targets = {
      positioning: 16,
      value_architecture: 15,
      pricing_packaging: 15,
      gtm_focus: 15,
      measurement: 16,
    };
  } else if (isScaling) {
    targets = {
      positioning: 15,
      value_architecture: 14,
      pricing_packaging: 14,
      gtm_focus: 15,
      measurement: 14,
    };
  } else {
    targets = {
      positioning: 14,
      value_architecture: 13,
      pricing_packaging: 13,
      gtm_focus: 14,
      measurement: 13,
    };
  }

  // Enterprise complexity increases the need for stronger value and pricing structure,
  // but should not imply near-perfect execution.
  if (acv.includes("250k+")) {
    targets.value_architecture += 1;
    targets.pricing_packaging += 1;
  } else if (acv.includes("75–250") || acv.includes("75-250")) {
    targets.value_architecture += 1;
  }

  // Longer cycles require more GTM discipline and better measurement hygiene
  if (cycle.includes("6–12") || cycle.includes("6-12") || cycle.includes("12+")) {
    targets.gtm_focus += 1;
    targets.measurement += 1;
  }

  // Usage-based / hybrid models need stronger pricing clarity
  if (model.includes("usage") || model.includes("hybrid")) {
    targets.pricing_packaging += 1;
  }

  // Fast growth increases the need for GTM discipline, but only slightly
  if (growth.includes("accelerating") || growth.includes("scaling rapidly")) {
    targets.gtm_focus += 1;
  }

  // Audit and hidden reports can be slightly more demanding,
  // while still representing functional thresholds, not perfection.
  if (tier === "audit" || tier === "hidden") {
    targets = {
      positioning: Math.min(20, targets.positioning),
      value_architecture: Math.min(20, targets.value_architecture + 1),
      pricing_packaging: Math.min(20, targets.pricing_packaging + 1),
      gtm_focus: Math.min(20, targets.gtm_focus),
      measurement: Math.min(20, targets.measurement + 1),
    };
  }

  return targets;
}

function getRadarLabels() {
  return {
    positioning: "Positioning",
    value_architecture: "Value",
    pricing_packaging: "Pricing",
    gtm_focus: "GTM",
    measurement: "Measurement",
  };
}

/* =========================================================
   Email Copy (OS-first)
========================================================= */

function renderExecSummary({ osScored, clientName, clientCompany }) {
  const niceConstraint = prettyPillar(osScored.primary_constraint_key);

  const subject = "Your Brand-to-GTM OS Executive Summary";

  const bodyText = `Hi ${clientName || "there"},

Your Brand-to-GTM OS Executive Summary is ready.

Company: ${clientCompany || "Your organization"}
OS alignment: ${osScored.interpretation_band} (${osScored.brand_to_gtm_os_score}/100)
Primary constraint: ${niceConstraint}
Confidence: ${osScored.confidence || "Moderate"}

Your report is ready to review.

Next step:
Book your 30-minute review call to walk through the findings and identify the most actionable priorities.

— Jasper
Vallenwood Consulting
`;

  const bodyHtml = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f4ea;padding:32px 16px;color:#2f2f2f;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6dfcf;border-radius:16px;overflow:hidden;">
      <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#ffffff,#fbfaf6);border-bottom:1px solid #e6dfcf;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6f875f;margin-bottom:10px;">
          Vallenwood Consulting
        </div>
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.1;color:#2f2f2f;">
          Your Brand-to-GTM OS Executive Summary
        </h1>
        <p style="margin:0;color:#6f6f69;font-size:15px;line-height:1.6;">
          A diagnostic snapshot of the operating constraint most likely to be affecting growth, pricing power, and go-to-market efficiency.
        </p>
      </div>

      <div style="padding:24px 28px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${clientName || "there"},</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
          Your diagnostic is complete. Here is the headline view of what the model surfaced:
        </p>

        <div style="border:1px solid #e6dfcf;border-radius:14px;padding:18px;background:#fbfaf6;margin-bottom:20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Company</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${clientCompany || "Your organization"}</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">OS Alignment</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${osScored.interpretation_band} (${osScored.brand_to_gtm_os_score}/100)</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Primary Constraint</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${niceConstraint}</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Confidence</p>
          <p style="margin:0;font-size:18px;font-weight:700;">${osScored.confidence || "Moderate"}</p>
        </div>

        <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">
          The next step is a short review call to pressure-test the diagnosis and identify the highest-leverage priorities.
        </p>

        <a href="https://vallenwoodconsultingllc.hbportal.co/schedule/68e972a4097e7b0027a71406"
           style="display:inline-block;background:#6f875f;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:12px;">
          Book Your Review Call
        </a>
      </div>

      <div style="padding:18px 28px;border-top:1px solid #e6dfcf;color:#6f6f69;font-size:13px;line-height:1.6;">
        This summary is directional and designed to surface leverage quickly, not replace a full strategic audit.
      </div>
    </div>
  </div>
  `;

  return { subject, bodyText, bodyHtml };
}

function renderAudit({ osScored, clientName, clientCompany, auditReportUrl }) {
  const subject = `Your Brand-to-GTM OS Strategic Audit — ${clientCompany || "Your Organization"}`;
  const niceConstraint = prettyPillar(osScored.primary_constraint_key);

  const bodyHtml = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f4ea;padding:32px 16px;color:#2f2f2f;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6dfcf;border-radius:16px;overflow:hidden;">

      <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#ffffff,#fbfaf6);border-bottom:1px solid #e6dfcf;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6f875f;margin-bottom:10px;">
          Vallenwood Consulting
        </div>
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.1;color:#2f2f2f;">
          Your Brand-to-GTM OS Strategic Audit
        </h1>
        <p style="margin:0;color:#6f6f69;font-size:15px;line-height:1.6;">
          A deeper strategic read on the operating constraints shaping positioning, pricing power, and go-to-market performance.
        </p>
      </div>

      <div style="padding:24px 28px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${clientName || "there"},</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
          Thank you for completing the Brand-to-GTM OS Diagnostic for <strong>${clientCompany || "your organization"}</strong>. Your Strategic Audit has been generated and is ready to review.
        </p>

        <div style="border:1px solid #e6dfcf;border-radius:14px;padding:18px;background:#fbfaf6;margin-bottom:20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Company</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${clientCompany || "Your organization"}</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">OS Alignment</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${osScored.interpretation_band} (${osScored.brand_to_gtm_os_score}/100)</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Primary Constraint</p>
          <p style="margin:0 0 16px;font-size:18px;font-weight:700;">${niceConstraint}</p>

          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Confidence</p>
          <p style="margin:0;font-size:18px;font-weight:700;">${osScored.confidence || "Moderate"}</p>
        </div>

        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
          The diagnostic has identified the operating constraint most likely to be limiting growth, pricing power, and GTM efficiency. Your full report includes a strategic SWOT, competitive context, pricing audit, and a 30/60/90-day action roadmap.
        </p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
          <strong>View your full report:</strong><br>
          <a href="${auditReportUrl || "https://vallenwoodconsulting.com"}" style="color:#6f875f;font-weight:600;text-decoration:none;">
            Brand-to-GTM OS Strategic Audit &rarr;
          </a>
        </p>

        <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">
          Included with your audit is a <strong>60-minute Brand-to-GTM Strategy Session</strong> where we walk through the findings, validate the diagnosis, and align on the highest-leverage next moves.
        </p>

        <a href="https://vallenwoodconsultingllc.hbportal.co/schedule/68fa3ed7c0d0af002f7fa007"
           style="display:inline-block;background:#6f875f;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 20px;border-radius:12px;font-size:15px;">
          Book Your 60-Minute Strategy Session
        </a>
      </div>

      <div style="padding:18px 28px;border-top:1px solid #e6dfcf;color:#6f6f69;font-size:13px;line-height:1.6;">
        This audit is designed to convert diagnosis into a focused action plan. Reports may take a few minutes to fully generate after submission.
      </div>

    </div>
  </div>
  `;

  const bodyText = `Hi ${clientName || "there"},

Thank you for completing the Brand-to-GTM OS Diagnostic for ${clientCompany || "your organization"}.

Your Strategic Audit is ready to review.

OS Alignment: ${osScored.interpretation_band} (${osScored.brand_to_gtm_os_score}/100)
Primary Constraint: ${niceConstraint}
Confidence: ${osScored.confidence || "Moderate"}

View your full report:
${auditReportUrl || ""}

Book your 60-minute Strategy Session:
https://vallenwoodconsultingllc.hbportal.co/schedule/68fa3ed7c0d0af002f7fa007

— Jasper
Vallenwood Consulting
`;

  return { subject, bodyText, bodyHtml };
}

function renderInsufficientDataEmail({ clientName, clientCompany }) {
  const subject = "Your Brand-to-GTM OS Executive Summary";

  const bodyText = `Hi ${clientName || "there"},

Thanks — I received your submission, but there isn’t enough data yet to generate a reliable OS score.

Company: ${clientCompany || "Your organization"}

Next step:
Reply with a bit more detail (or resubmit the form) so I can produce an accurate summary.

— Jasper
Vallenwood Consulting
`;

  const bodyHtml = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f4ea;padding:32px 16px;color:#2f2f2f;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6dfcf;border-radius:16px;overflow:hidden;">
      <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#ffffff,#fbfaf6);border-bottom:1px solid #e6dfcf;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6f875f;margin-bottom:10px;">
          Vallenwood Consulting
        </div>
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.1;color:#2f2f2f;">
          Your Brand-to-GTM OS Executive Summary
        </h1>
        <p style="margin:0;color:#6f6f69;font-size:15px;line-height:1.6;">
          We received your submission, but there was not enough structured input to generate a reliable OS score yet.
        </p>
      </div>

      <div style="padding:24px 28px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Hi ${clientName || "there"},</p>

        <div style="border:1px solid #e6dfcf;border-radius:14px;padding:18px;background:#fbfaf6;margin-bottom:20px;">
          <p style="margin:0 0 8px;font-size:13px;color:#6f6f69;text-transform:uppercase;letter-spacing:.04em;">Company</p>
          <p style="margin:0;font-size:18px;font-weight:700;">${clientCompany || "Your organization"}</p>
        </div>

        <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
          To produce a reliable diagnostic, I need a bit more information about your current go-to-market system.
        </p>

        <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">
          Reply with additional detail or resubmit the form, and I’ll generate an updated summary.
        </p>

        <a href="mailto:jasper@vallenwoodconsulting.com?subject=Brand-to-GTM%20OS%20Follow-Up"
           style="display:inline-block;background:#6f875f;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:12px;">
          Reply with More Detail
        </a>
      </div>

      <div style="padding:18px 28px;border-top:1px solid #e6dfcf;color:#6f6f69;font-size:13px;line-height:1.6;">
        Once more input is available, the model will generate a fuller diagnostic view.
      </div>
    </div>
  </div>
  `;

  return { subject, bodyText, bodyHtml };
}

/* =========================================================
   Report Builder
========================================================= */

function buildReport({
  tier,
  clientName,
  clientEmail,
  clientCompany,
  clientWebsite,
  answers,
  osScored,
  legacyScored,
  content,
}) {
  const generatedAt = new Date().toISOString();
  const na = normalizeAnswers(answers);

  const contradictionBullets = (osScored.contradictions || []).slice(0, 3).map((c) => c.tension);

  const pillarLabels = {
    positioning: "Positioning & Category",
    value_architecture: "Value Architecture",
    pricing_packaging: "Pricing & Packaging",
    gtm_focus: "GTM Focus",
    measurement: "Measurement",
  };

  const primarySymptoms = (osScored.contradictions || [])
    .filter((c) => pillarKeyFromLabel(c.pillar) === osScored.primary_constraint_key)
    .slice(0, 3)
    .map((c) => c.tension);

  const baseReport = {
    schema_version: "1.1",
    generated_at: generatedAt,
    tier,
    client: {
      company_name: clientCompany || null,
      contact_name: clientName || null,
      contact_email: clientEmail || "",
      website: clientWebsite || null,
    },
    inputs: {
      source: "honeybook",
      raw_answers: answers,
      normalized_answers: na,
    },

    scoring: {
      os_scoring_version: OS_SCORING_VERSION,
      overall_score: osScored.brand_to_gtm_os_score,
      overall_max: 100,
      band: osScored.interpretation_band,
      confidence: osScored.confidence || "Moderate",
      contradiction_count: (osScored.contradictions || []).length,
      contradiction_penalty: osScored.contradiction_penalty || 0,
      operating_tensions: osScored.contradictions || [],
      primary_constraint: {
        key: osScored.primary_constraint_key,
        label: prettyPillar(osScored.primary_constraint_key),
        why_it_matters:
          "This pillar most constrains performance across brand clarity, pricing power, and go-to-market execution.",
        symptoms: primarySymptoms,
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
          "This diagnostic reflects alignment across five pillars of the Brand-to-GTM Operating System. The goal is to identify the operating constraint that, if improved, will unlock the most leverage.",
        key_observations: contradictionBullets,
        what_to_do_next: [
          "Confirm the primary constraint with a short review call",
          "Pressure-test the operating tensions surfaced by the model",
          "Prioritize 1–2 quick wins to improve clarity and commercial outcomes",
        ],
      },
      pillar_interpretations: [
        {
          pillar_key: osScored.primary_constraint_key,
          interpretation:
            "Your lowest-leverage point is likely creating downstream friction across differentiation, pricing power, and GTM efficiency.",
          quick_wins: [
            "Define a sharper category POV and differentiation claim",
            "Anchor value in measurable outcomes and economic proof",
            "Reduce discounting by tightening packaging and guardrails",
          ],
          questions_to_answer: [
            "What do we win on besides price?",
            "Which customer outcomes are repeatable and provable?",
            "What is the simplest packaging structure customers understand quickly?",
          ],
        },
      ],
      operating_tensions: (osScored.contradictions || []).slice(0, 3).map((c) => ({
        tension: c.tension,
        implication: c.implication,
        pillar: c.pillar,
        severity: c.severity,
      })),
    },

    deliverables: {
      email: {
        subject: content.subject,
        body_text: content.bodyText,
        body_html: content.bodyHtml || null,
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
        "This diagnostic is based on provided inputs and calibrated scoring rules.",
        "Competitive analysis and pricing insights should be validated with market research and live stakeholder review.",
      ],
    },
  };

  if (tier === "audit") {
    baseReport.full_tier = buildFullTierPlaceholder({ answers, osScored });
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
        "Operating tensions across brand, pricing, and GTM layers",
        "Competitive pricing & packaging audit (hypotheses + what-to-verify)",
        "A prioritized 30/90-day roadmap + first sprint plan",
      ],
      offer: { name: "Full Strategic Audit", price_usd: 499, cta_label: "Upgrade to Full Audit", cta_url: null },
    },
  };
}

function buildFullTierPlaceholder({ answers, osScored }) {
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
        "Establish clearer positioning, stronger value proof, and sharper commercial discipline to improve growth efficiency.",
      principles: ["Clarity over breadth", "Proof over promises", "Focus over fragmentation"],
      thirty_day: [],
      ninety_day: [],
      six_to_twelve_month: [],
    },
    operating_tensions: (osScored.contradictions || []).slice(0, 5),
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
   LLM Enrichment
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
  const model = process.env.LLM_MODEL || "gpt-4o";

  const compactInput = {
    tier: report.tier,
    scoring: report.scoring,
    normalized_answers: report.inputs?.normalized_answers,
  };

  const systemPrompt =
    "You are a senior B2B brand and go-to-market strategist. Return ONLY valid JSON. No markdown. No commentary. Do not fabricate market data. Use hypotheses when information is missing. Identify cross-pillar contradictions where one part of the GTM system appears more mature than another. Favor consultant-style interpretation over generic summaries.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this shape:

{
  "narrative": {
    "executive_summary": {
      "headline": "",
      "summary_paragraph": "",
      "key_observations": [],
      "what_to_do_next": []
    },
    "pillar_interpretations": [
      {
        "pillar_key": "",
        "interpretation": "",
        "quick_wins": [],
        "questions_to_answer": []
      }
    ],
    "operating_tensions": [
      {
        "tension": "",
        "implication": "",
        "pillar": "",
        "severity": 1
      }
    ]
  },
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
    },
    "operating_tensions": []
  }
}

Diagnostic data:
${JSON.stringify(compactInput)}
`.trim();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 2000,
  });

  const text = response.choices[0]?.message?.content || "";
  const parsed = safeJsonParse(text);

  if (!validateAuditEnrichment(parsed)) {
    throw new Error("Invalid LLM enrichment output");
  }

  return parsed;
}

/* =========================================================
   Auth helper
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
   Insufficient data guard
========================================================= */

const MIN_REQUIRED_FIELDS = 9;

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
   Hosted report builders
========================================================= */

function getBaseUrl(req) {
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  }

  const proto =
    req.headers["x-forwarded-proto"] ||
    (req.headers.host && req.headers.host.includes("localhost") ? "http" : "https");

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function buildExecReportData(report) {
  const pillarArray = Array.isArray(report?.scoring?.pillar_scores)
    ? report.scoring.pillar_scores
    : [];

  const pillarScores = {
    positioning: pillarArray.find((p) => p.key === "positioning")?.score ?? 0,
    value_architecture: pillarArray.find((p) => p.key === "value_architecture")?.score ?? 0,
    pricing_packaging: pillarArray.find((p) => p.key === "pricing_packaging")?.score ?? 0,
    gtm_focus: pillarArray.find((p) => p.key === "gtm_focus")?.score ?? 0,
    measurement: pillarArray.find((p) => p.key === "measurement")?.score ?? 0,
  };

  const sorted = [...pillarArray].sort((a, b) => a.score - b.score);
  const strongest = [...pillarArray].sort((a, b) => b.score - a.score)[0] || null;
  const secondary = sorted[1] || null;

  const normalizedAnswers = report?.inputs?.normalized_answers || {};
  const targetPillarScores = getDynamicTargetPillarScores(normalizedAnswers, "exec");
  const radarLabels = getRadarLabels();

  const secondaryExplanation = secondary
    ? `Once the primary constraint is improved, ${secondary.label} is likely to become the next limiting factor in the operating system. This is a normal progression in systems where one fix increases pressure on the next-weakest pillar.`
    : "";

  return {
    company_name: report?.client?.company_name || "Company",
    contact_name: report?.client?.contact_name || "Client",
    website: report?.client?.website || "",
    report_date: report?.generated_at
      ? new Date(report.generated_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        })
      : "",

    overall_score: report?.scoring?.overall_score ?? 0,
    score_band: report?.scoring?.band || "",
    confidence: report?.scoring?.confidence || "Moderate",

    primary_constraint_label: report?.scoring?.primary_constraint?.label || "",
    primary_constraint_why_it_matters:
      report?.scoring?.primary_constraint?.why_it_matters || "",

    executive_summary_paragraph:
      report?.narrative?.executive_summary?.summary_paragraph || "",
    executive_headline:
      report?.narrative?.executive_summary?.headline || "",

    diagnosis_implications:
      report?.scoring?.primary_constraint?.downstream_impacts?.slice(0, 3) || [],

    risks:
      report?.narrative?.operating_tensions?.slice(0, 3).map((t) => t.tension) ||
      report?.scoring?.legacy?.flags?.slice(0, 3) ||
      [],

    operating_tensions:
      report?.narrative?.operating_tensions?.slice(0, 3) || [],

    benchmark_context: {
      average_saas_company: 62,
      top_quartile: 78,
      elite_gtm_system: 85,
    },

    pillar_scores: pillarScores,
    target_pillar_scores: targetPillarScores,
    radar_labels: radarLabels,

    primary_constraint_score:
      pillarArray.find((p) => p.key === report?.scoring?.primary_constraint?.key)?.score ?? 0,

    primary_constraint_interpretation:
      report?.narrative?.pillar_interpretations?.[0]?.interpretation || "",

    strongest_pillar_label: strongest?.label || "",
    strongest_pillar_score: strongest?.score ?? 0,

    secondary_constraint_label: secondary?.label || "",
    secondary_constraint_explanation: secondaryExplanation,

    top_moves_30_days:
      report?.exec_tier?.top_moves_30_days?.slice(0, 3).map((m) => ({
        title: m.title,
        why: m.why,
        how: Array.isArray(m.how) ? m.how.slice(0, 3) : [],
      })) || [],
  };
}

function buildAuditReportData(report) {
  const normalizedAnswers = report?.inputs?.normalized_answers || {};
  const targetPillarScores = getDynamicTargetPillarScores(normalizedAnswers, "audit");
  const radarLabels = getRadarLabels();
  const pillarArray = Array.isArray(report?.scoring?.pillar_scores)
    ? report.scoring.pillar_scores
    : [];

  return {
    company_name: report?.client?.company_name || "Company",
    contact_name: report?.client?.contact_name || "Client",
    website: report?.client?.website || "",
    report_date: report?.generated_at
      ? new Date(report.generated_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        })
      : "",

    overall_score: report?.scoring?.overall_score ?? 0,
    score_band: report?.scoring?.band || "",
    confidence: report?.scoring?.confidence || "Moderate",

    primary_constraint_label: report?.scoring?.primary_constraint?.label || "",
    primary_constraint_why_it_matters:
      report?.scoring?.primary_constraint?.why_it_matters || "",

    executive_summary_paragraph:
      report?.narrative?.executive_summary?.summary_paragraph || "",
    executive_headline:
      report?.narrative?.executive_summary?.headline || "",

    pillar_scores: {
      positioning: pillarArray.find((p) => p.key === "positioning")?.score ?? 0,
      value_architecture: pillarArray.find((p) => p.key === "value_architecture")?.score ?? 0,
      pricing_packaging: pillarArray.find((p) => p.key === "pricing_packaging")?.score ?? 0,
      gtm_focus: pillarArray.find((p) => p.key === "gtm_focus")?.score ?? 0,
      measurement: pillarArray.find((p) => p.key === "measurement")?.score ?? 0,
    },

    target_pillar_scores: targetPillarScores,
    radar_labels: radarLabels,

    benchmark_context: {
      average_saas_company: 62,
      top_quartile: 78,
      elite_gtm_system: 85,
    },

    operating_tensions:
      report?.narrative?.operating_tensions?.slice(0, 5) ||
      report?.scoring?.operating_tensions?.slice(0, 5) ||
      [],

    swot: report?.full_tier?.swot || null,
    competitive_context: report?.full_tier?.competitive_context || null,
    pricing_packaging_audit: report?.full_tier?.pricing_packaging_audit || null,
    roadmap: report?.full_tier?.roadmap || null,
    first_sprint_plan: report?.full_tier?.first_sprint_plan || null,
  };
}

function buildHiddenReportData(report) {
  const pillarArray = Array.isArray(report?.scoring?.pillar_scores)
    ? report.scoring.pillar_scores
    : [];

  const ranked = [...pillarArray].sort((a, b) => a.score - b.score);

  const pillarScores = {};
  pillarArray.forEach((p) => {
    pillarScores[p.key] = p.score;
  });

  const primary = ranked[0] || null;

  const normalized = report?.inputs?.normalized_answers || {};
  const targetPillarScores = getDynamicTargetPillarScores(normalized, "hidden");
  const radarLabels = getRadarLabels();
  const rawChannels = normalized?.acquisition_channels;

  const primaryChannels = Array.isArray(rawChannels)
    ? rawChannels
    : typeof rawChannels === "string"
      ? rawChannels.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  return {
    company_name: report?.client?.company_name || "Company",
    contact_name: report?.client?.contact_name || "Client",
    report_date: report?.generated_at
      ? new Date(report.generated_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        })
      : "",

    diagnostic_snapshot: {
      annual_revenue: normalized?.annual_revenue || null,
      acv: normalized?.acv || null,
      sales_cycle: normalized?.sales_cycle || null,
      close_rate: normalized?.close_rate || null,
      primary_channels: primaryChannels,
      measurement_model: normalized?.marketing_measured_by || null,
      growth_status: normalized?.growth_status || null,
    },

    benchmark_context: {
      average_saas_company: 62,
      top_quartile: 78,
      elite_gtm_system: 88,
    },

    scoring: {
      overall_score: report?.scoring?.overall_score || 0,
      score_band: report?.scoring?.band || "",
      confidence: report?.scoring?.confidence || "Moderate",
      pillar_scores: pillarScores,
      target_pillar_scores: targetPillarScores,
      radar_labels: radarLabels,
      pillar_ranked: ranked.map((p) => ({
        key: p.key,
        label: p.label,
        score: p.score,
      })),
      primary_constraint: primary
        ? {
            key: primary.key,
            label: primary.label,
            score: primary.score,
          }
        : null,
    },

    signal_analysis: {
      operating_tensions: report?.scoring?.operating_tensions || [],
      strength_signals: [
        ...(pillarScores.measurement >= 17
          ? ["Measurement maturity appears relatively strong compared to other pillars."]
          : []),
        ...(pillarScores.gtm_focus >= 17
          ? ["GTM execution appears relatively strong compared to other pillars."]
          : []),
      ],
      constraint_signals: [
        ...(pillarScores.value_architecture < 14
          ? ["Weak value architecture may create downstream pressure on pricing and positioning."]
          : []),
        ...(pillarScores.pricing_packaging < 14
          ? ["Pricing and packaging appear to be limiting margin protection or deal discipline."]
          : []),
      ],
      risk_signals: (report?.scoring?.operating_tensions || [])
        .slice(0, 3)
        .map((c) => c.implication),
      opportunity_signals: [
        ...(String(normalized?.discounting || "").includes("Rarely")
          ? ["Low discounting frequency suggests some pricing power already exists."]
          : []),
      ],
    },

    interpretation: {
      executive_readout:
        "Initial diagnostic suggests the primary leverage point lies in improving the constraint most likely to suppress pricing power, differentiation, or GTM efficiency.",
      root_cause_hypotheses:
        (report?.scoring?.operating_tensions || []).slice(0, 3).map((c) => c.implication),
    },

    call_briefing: {
      opening_summary:
        "Begin by confirming where the commercial motion appears stronger than the proof, pricing, or measurement systems supporting it.",
      top_questions_to_ask: [
        "How do prospects typically evaluate ROI before purchasing?",
        "Where in the sales process do pricing objections appear?",
        "Which customer proof points most often move deals forward?"
      ],
      areas_to_validate_live: [
        "Whether pricing tiers reflect actual customer value segments",
        "Whether sales messaging consistently leads with outcomes",
        "Whether attribution trust matches leadership expectations"
      ]
    },

    consulting_opportunity: {
      likely_needs: [
        "Value architecture refinement",
        "Pricing and packaging strategy",
        "Messaging system alignment"
      ],
      priority_engagement_angle: prettyPillar(report?.scoring?.primary_constraint?.key) || "Strategic Diagnostic Sprint",
      upsell_readiness:
        (report?.scoring?.overall_score || 0) <= 70 ? "High" : "Moderate"
    }
  };
}

async function buildReportUrl(req, report, tier) {
  const baseUrl = getBaseUrl(req);
  const reportId = makeReportId();

  let reportData;
  if (tier === "audit") {
    reportData = buildAuditReportData(report);
  } else if (tier === "hidden") {
    reportData = buildHiddenReportData(report);
  } else {
    reportData = buildExecReportData(report);
  }

  await saveReport(reportId, { tier, reportData });

  return `${baseUrl}/api/report?id=${reportId}&tier=${tier}`;
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

    const token = extractAuthToken(req);
    if (!token || token !== process.env.VW_TOKEN) {
      L.finish(401);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = req.body || {};
    const rawAnswers = payload.answers;

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

    const answers = normalizeIncomingAnswers(rawAnswers);

    let tier = payload.tier || "exec";
    if (tier === "full") tier = "audit";

    const clientEmail = payload.client_email || "";
    const clientName = payload.client_name || "";
    const clientCompany = payload.client_company || "";
    const clientWebsite = payload.client_website || "";

    // Legacy scoring
    const tLegacy = L.mark();
    const config = getConfig();
    const legacyScored = scoreLegacy(answers, config);
    L.step("scoreLegacy", tLegacy, { total: legacyScored.total, band: legacyScored.band });

    // Normalized OS inputs
    const tOS = L.mark();
    const na = normalizeAnswers(answers);

    const osInputs = {
      annual_revenue: na.annual_revenue,
      revenue_model: na.revenue_model,
      acv: na.acv,
      sales_cycle: na.sales_cycle,
      close_rate: na.close_rate,
      category: na.category,
      compared_to: na.compared_to,

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

      growth_status: na.growth_status,
      marketing_measured_by: na.marketing_measured_by,
      attribution_trusted: na.attribution_trusted,
      forecast_accuracy: na.forecast_accuracy,
    };

    const { presentCount, missingKeys } = countPresentRequired(osInputs);

    if (presentCount < MIN_REQUIRED_FIELDS) {
      const tRender = L.mark();
      const content = renderInsufficientDataEmail({ clientName, clientCompany });
      L.step("render_insufficient", tRender, { presentCount, missing: missingKeys.length });

      const generatedAt = new Date().toISOString();

      const report = {
        schema_version: "1.1",
        generated_at: generatedAt,
        tier,
        client: {
          company_name: clientCompany || null,
          contact_name: clientName || null,
          contact_email: clientEmail || "",
          website: clientWebsite || null,
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
          confidence: null,
          contradiction_count: 0,
          contradiction_penalty: 0,
          operating_tensions: [],
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
          operating_tensions: [],
        },
        deliverables: {
          email: {
            subject: content.subject,
            body_text: content.bodyText,
            body_html: content.bodyHtml || null,
          },
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
        confidence: null,
        insufficient_data: true,
        present_required_count: presentCount,
        required_min: MIN_REQUIRED_FIELDS,
        missing_required_fields: missingKeys,
      };

      const includeReportJson = process.env.INCLUDE_REPORT_JSON === "1";

      const execReportUrl =
        tier === "exec" ? await buildReportUrl(req, report, "exec") : null;

      const auditReportUrl =
        tier === "audit" ? await buildReportUrl(req, report, "audit") : null;

      const hiddenReportUrl = await buildReportUrl(req, report, "hidden");

      L.finish(200);
      return res.status(200).json({
        report,
        ...(includeReportJson ? { report_json: JSON.stringify(report) } : {}),

        brand_to_gtm_os_score: null,
        brand_to_gtm_os_band: "Insufficient data",
        brand_to_gtm_os_pillar_scores: {},
        brand_to_gtm_os_primary_constraint: null,
        brand_to_gtm_os_primary_constraint_label: null,
        brand_to_gtm_os_confidence: null,
        brand_to_gtm_os_operating_tensions: [],

        summary,

        tier,
        overall_score: null,
        band: "Insufficient data",
        primary_constraint: null,

        email_subject: content.subject,
        email_body_text: content.bodyText,
        email_body_html: content.bodyHtml || null,
        client_email: clientEmail,

        exec_report_url: execReportUrl,
        audit_report_url: auditReportUrl,
        hidden_report_url: hiddenReportUrl,
      });
    }

    // NEW OS scoring engine
    const scoring = scoreDiagnostic(osInputs);

    const osScored = {
      brand_to_gtm_os_score: scoring.osScore,
      interpretation_band: scoreBand(scoring.osScore),
      primary_constraint_key: pillarKeyFromLabel(scoring.primaryConstraint),
      pillar_scores: {
        positioning: scoring.scores.positioning,
        value_architecture: scoring.scores.value,
        pricing_packaging: scoring.scores.pricing,
        gtm_focus: scoring.scores.gtm,
        measurement: scoring.scores.measurement,
      },
      confidence: scoring.confidence,
      contradictions: scoring.contradictions || [],
      contradiction_penalty: scoring.contradictionPenalty || 0,
      raw_score: scoring.rawScore,
      adjusted_raw_score: scoring.adjustedRawScore,
    };

    L.step("scoreOS", tOS, {
      total: osScored.brand_to_gtm_os_score,
      band: osScored.interpretation_band,
      confidence: osScored.confidence,
    });

    const tRender = L.mark();
    const content =
      tier === "audit"
        ? renderAudit({ osScored, clientName, clientCompany })
        : renderExecSummary({ osScored, clientName, clientCompany });
    L.step("render", tRender);

    const tBuild = L.mark();
    const report = buildReport({
      tier,
      clientName,
      clientEmail,
      clientCompany,
      clientWebsite,
      answers,
      osScored,
      legacyScored,
      content,
    });

    report.scoring.insufficient_data = false;
    report.scoring.required_min = MIN_REQUIRED_FIELDS;
    report.scoring.present_required_count = presentCount;
    report.scoring.missing_required_fields = [];

    L.step("buildReport", tBuild);

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

        // Also map top-level enrichment keys into full_tier
        if (enriched?.swot) report.full_tier.swot = enriched.swot;
        if (enriched?.roadmap) report.full_tier.roadmap = { ...report.full_tier.roadmap, ...enriched.roadmap };
        if (enriched?.pricing_insight) report.full_tier.pricing_packaging_audit = { ...report.full_tier.pricing_packaging_audit, ...enriched.pricing_insight };
        if (enriched?.competitive_context) report.full_tier.competitive_context = { ...report.full_tier.competitive_context, ...enriched.competitive_context };
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
      confidence: osScored.confidence,
      insufficient_data: false,
      present_required_count: presentCount,
      required_min: MIN_REQUIRED_FIELDS,
      missing_required_fields: [],
    };

    const includeReportJson = process.env.INCLUDE_REPORT_JSON === "1";

    const execReportUrl =
      tier === "exec" ? await buildReportUrl(req, report, "exec") : null;

    const auditReportUrl =
      tier === "audit" ? await buildReportUrl(req, report, "audit") : null;

    const hiddenReportUrl = await buildReportUrl(req, report, "hidden");

    L.finish(200);

    return res.status(200).json({
      report,
      ...(includeReportJson ? { report_json: JSON.stringify(report) } : {}),

      brand_to_gtm_os_score: osScored.brand_to_gtm_os_score,
      brand_to_gtm_os_band: osScored.interpretation_band,
      brand_to_gtm_os_pillar_scores: osScored.pillar_scores,
      brand_to_gtm_os_primary_constraint: osScored.primary_constraint_key,
      brand_to_gtm_os_primary_constraint_label: prettyPillar(osScored.primary_constraint_key),
      brand_to_gtm_os_confidence: osScored.confidence,
      brand_to_gtm_os_operating_tensions: osScored.contradictions,

      summary,

      tier,
      overall_score: osScored.brand_to_gtm_os_score,
      band: osScored.interpretation_band,
      primary_constraint: osScored.primary_constraint_key,

      email_subject: content.subject,
      email_body_text: content.bodyText,
      email_body_html: content.bodyHtml || null,
      client_email: clientEmail,

      exec_report_url: execReportUrl,
      audit_report_url: auditReportUrl,
      hidden_report_url: hiddenReportUrl,
    });
    } catch (err) {
    L.error("Unhandled error", { message: err?.message, name: err?.name });
    L.finish(500);
    console.error("[diag] Unhandled error:", err);

    return res.status(500).json({
      error: "Server error",
      message: err?.message || null,
      name: err?.name || null
    });
  }
}