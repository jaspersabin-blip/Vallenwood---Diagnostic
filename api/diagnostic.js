// api/diagnostic.js
// Drop-in replacement for your current file.
// Keeps your existing Zapier fields (email_subject, email_body_text, etc.)
// Adds a new structured `report` object (schema v1.0) for future PDF/LLM expansion.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Simple auth so random people can’t hit your endpoint
  const token = req.headers["x-vw-token"];
  if (!token || token !== process.env.VW_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.body || {};
  const answers = payload.answers;

  if (
    answers === undefined ||
    answers === null ||
    typeof answers !== "object" ||
    Array.isArray(answers) ||
    Object.keys(answers).length === 0
  ) {
    return res.status(400).json({ error: "Invalid payload: 'answers' must be a non-empty object." });
  }

  // Normalize tier naming (support both "audit" and "full" if you ever use it)
  let tier = payload.tier || "exec"; // "exec" | "audit"
  if (tier === "full") tier = "audit";

  const clientEmail = payload.client_email || "";
  const clientName = payload.client_name || "";

  const config = getConfig();
  const scored = score(answers, config);

  const content =
    tier === "audit"
      ? renderAudit({ scored, answers, clientName })
      : renderExecSummary({ scored, answers, clientName });

  const report = buildReport({
    tier,
    clientName,
    clientEmail,
    answers,
    scored,
    config,
    content
  });

  // Backward-compatible response for existing Zapier mappings:
  return res.status(200).json({
    // ✅ new structured payload for PDF/LLM later
    report,
    report_json: JSON.stringify(report),


    // ✅ keep old keys for now (so you don’t break Zaps)
    tier,
    overall_score: scored.total,
    band: scored.band,
    primary_constraint: scored.primaryConstraint,
    pillar_scores: scored.pillars,
    flags: scored.flags,
    email_subject: content.subject,
    email_body_text: content.bodyText,
    // Optional if you want HTML later:
    // email_body_html: content.bodyHtml,
    client_email: clientEmail
  });
}

/* ---------------------------
   Report Builder (Schema v1.0)
---------------------------- */

function buildReport({ tier, clientName, clientEmail, answers, scored, config, content }) {
  const generatedAt = new Date().toISOString();

  const pillarScoresArray = [
    pillarObj("positioning", scored.pillars.positioning),
    pillarObj("value_architecture", scored.pillars.value_architecture),
    pillarObj("pricing_packaging", scored.pillars.pricing_packaging),
    pillarObj("gtm_focus", scored.pillars.gtm_focus),
    pillarObj("measurement", scored.pillars.measurement)
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
      website: null
    },
    inputs: {
      source: "honeybook",
      raw_answers: answers,
      normalized_answers: normalizeAnswers(answers)
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
        recommendation: ""
      }))
    },
    narrative: buildNarrative({ scored }),
    deliverables: {
      email: {
        subject: content.subject,
        body_text: content.bodyText,
        body_html: null
      },
      pdf: {
        title: tier === "audit" ? "Brand-to-GTM OS Strategic Audit" : "Brand-to-GTM OS Executive Summary",
        pdf_url: null,
        html_url: null,
        pages_estimate: tier === "audit" ? 10 : 3
      }
    },
    disclaimer: {
      ai_assisted: false, // flip to true once you add LLM output
      limitations: [
        "This diagnostic is based on provided inputs and deterministic scoring rules.",
        "Competitive analysis and pricing insights (when present) should be validated with market research."
      ]
    }
  };

  if (tier === "audit") {
    baseReport.full_tier = buildFullTierPlaceholder({ scored, answers });
  } else {
    baseReport.exec_tier = buildExecTierUpsell({ scored });
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
    risks: score <= 2 ? ["Pillar appears underdeveloped based on structured signals."] : []
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
      "Inconsistent messaging and weak differentiation"
    ]
  };
}

function buildNarrative({ scored }) {
  const headline = `${scored.band}: primary constraint is ${prettyPillar(scored.primaryConstraint)}`;
  const observations = (scored.flags || []).length
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
        "Decide if a full Strategic Audit is warranted"
      ]
    },
    pillar_interpretations: [
      {
        pillar_key: scored.primaryConstraint,
        interpretation:
          "Your lowest-scoring pillar is likely creating downstream friction across differentiation, pricing power, and GTM efficiency.",
        quick_wins: [
          "Define a sharper category POV and differentiation claim",
          "Anchor value in measurable outcomes (economic proof)",
          "Reduce discounting by tightening packaging and guardrails"
        ],
        questions_to_answer: [
          "What do we win on besides price?",
          "Which customer outcomes are repeatable and provable?",
          "What is the simplest packaging structure customers understand quickly?"
        ]
      }
    ]
  };
}

function buildExecTierUpsell({ scored }) {
  return {
    top_moves_30_days: [
      {
        title: "Clarify positioning in one sentence",
        why: "Positioning clarity reduces sales friction and improves pricing power.",
        how: [
          "Write a category POV + differentiation claim",
          "Validate with 3 customer calls",
          "Align homepage + pitch deck messaging"
        ],
        expected_impact: "Improved consistency in sales conversations and competitive win rates.",
        effort: "low"
      },
      {
        title: "Quantify value with 2–3 proof points",
        why: "Economic proof reduces discounting and speeds deal cycles.",
        how: [
          "Identify top 2 metrics customers care about",
          "Build 1-page ROI story template",
          "Instrument one customer case quickly"
        ],
        expected_impact: "Higher close rate with fewer concessions.",
        effort: "medium"
      },
      {
        title: "Tighten pricing guardrails",
        why: "Discounting often signals weak packaging and unclear value anchors.",
        how: [
          "Define discount thresholds",
          "Standardize approval workflow",
          "Improve tier naming and feature/value ladders"
        ],
        expected_impact: "Better margin stability and improved deal discipline.",
        effort: "medium"
      }
    ],
    upgrade_positioning: {
      headline: "What the Full Strategic Audit Unlocks",
      value_bullets: [
        "A pillar-by-pillar diagnosis with specific root-cause hypotheses",
        "SWOT tied directly to Brand-to-GTM levers",
        "Competitive pricing & packaging audit (hypotheses + what-to-verify)",
        "A prioritized 30/90-day roadmap + first sprint plan"
      ],
      what_you_get: [
        "SWOT tied to Brand-to-GTM pillars",
        "Competitive pricing & packaging audit (hypotheses + validation plan)",
        "Prioritized 30/90-day roadmap with sprint plan"
      ],
      offer: {
        name: "Full Strategic Audit",
        price_usd: 499,
        cta_label: "Upgrade to Full Audit",
        cta_url: null
      }
    }
  };
}

function buildFullTierPlaceholder({ scored, answers }) {
  // Placeholder v1.0. You’ll replace these sections with LLM output later.
  return {
    swot: {
      strengths: [{ point: "Strength placeholder", evidence: [] }],
      weaknesses: [{ point: "Weakness placeholder", evidence: [] }],
      opportunities: [{ point: "Opportunity placeholder", evidence: [] }],
      threats: [{ point: "Threat placeholder", evidence: [] }]
    },
    competitive_context: {
      category: answers["What category do you compete in?"] || null,
      most_compared_to: answers["Who do customers compare you to most often?"]
        ? [answers["Who do customers compare you to most often?"]]
        : [],
      competitive_archetypes: [],
      positioning_hypotheses: []
    },
    pricing_packaging_audit: {
      current_state_signals: [],
      pricing_power_risks: [],
      discounting_diagnosis: "",
      packaging_issues: [],
      hypotheses_to_test: [],
      what_to_validate: [],
      first_fixes: []
    },
    roadmap: {
      north_star: "Establish clear positioning and value proof to reduce discounting and improve GTM efficiency.",
      principles: ["Clarity over breadth", "Proof over promises", "Focus over fragmentation"],
      thirty_day: [],
      ninety_day: [],
      six_to_twelve_month: []
    },
    first_sprint_plan: { weeks: [] },
    appendix: {
      response_summary: Object.entries(answers).map(([question, answer]) => ({
        question,
        answer: String(answer ?? ""),
        notes: null
      }))
    }
  };
}

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
    discounting: answers["How often are discounts required to close deals?"] ?? null,
    pricing_clarity: answers["Do customers clearly understand your pricing tiers?"] ?? null,
    gross_margin: answers["What is your gross margin (%)?"] ?? null,
    acquisition_channels: answers["What are your primary acquisition channels (select up to 3)"] ?? null,
    cac_by_channel: answers["Do you know CAC by channel?"] ?? null,
    growth_status: answers["How would you rate your growth status?"] ?? null,
    marketing_measured_by: answers["Marketing is measured primarily by:"] ?? null,
    attribution_trusted: answers["Is attribution trusted internally?"] ?? null,
    forecast_accuracy: answers["Are revenue forecasts accurate within 10%"] ?? null
  };
}

/* ---------------------------
   Existing Scoring + Copy (unchanged)
---------------------------- */

function getConfig() {
  return {
    version: "v1",
    pillar_base_score: 3,
    pillar_min: 0,
    pillar_max: 5,
    score_rules: {
      positioning: [
        { if: { "Why do you most often win deals?": "Lowest price" }, delta: -2, flag: "Price-led wins suggest commoditization risk." },
        { if: { "Why do you most often lose deals?": "Price" }, delta: -2, flag: "Pricing pressure indicates weak value anchoring." },
        { if: { "Why do you most often lose deals?": "Lack of differentiation" }, delta: -2, flag: "Differentiation gap in competitive deals." },
        { if: { "Do customers describe your company consistently?": "Often unclear" }, delta: -2, flag: "Positioning clarity issue." },
        { if: { "Why do you most often win deals?": "Clear differentiation" }, delta: 2 },
        { if: { "Why do you most often win deals?": "Brand trust" }, delta: 1 }
      ],
      value_architecture: [
        { if: { "Can you quantify ROI for most customers?": "Yes — documented & repeatable" }, delta: 3 },
        { if: { "Can you quantify ROI for most customers?": "No" }, delta: -3, flag: "ROI not clearly quantified." },
        { if: { "Sales conversations primarily lead with:": "Features" }, delta: -2, flag: "Feature-led selling limits pricing power." },
        { if: { "Sales conversations primarily lead with:": "Financial ROI" }, delta: 2 },
        { if: { "What financial metrics do customers see improve due to your product?": "Not clearly defined" }, delta: -2, flag: "Economic value not clearly anchored to metrics." }
      ],
      pricing_packaging: [
        { if: { "How often are discounts required to close deals?": "Frequently (40%+)" }, delta: -3, flag: "Frequent discounting compresses margin." },
        { if: { "How often are discounts required to close deals?": "Sometimes (10–40%)" }, delta: -1 },
        { if: { "Do customers clearly understand your pricing tiers?": "Often confused" }, delta: -2, flag: "Pricing structure may be unclear." },
        { if: { "What is your gross margin (%)?": "Under 50%" }, delta: -2 },
        { if: { "What is your gross margin (%)?": "75%+" }, delta: 2 }
      ],
      gtm_focus: [
        { if: { "Do you know CAC by channel?": "No" }, delta: -2, flag: "Channel economics unclear." },
        { if: { "How would you rate your growth status?": "Stalled" }, delta: -2, flag: "Growth stall indicator." },
        { if: { "How would you rate your growth status?": "Plateauing" }, delta: -1 }
      ],
      measurement: [
        { if: { "Marketing is measured primarily by:": "Leads" }, delta: -2, flag: "Lead-focused measurement may signal vanity metrics." },
        { if: { "Marketing is measured primarily by:": "Revenue" }, delta: 2 },
        { if: { "Is attribution trusted internally?": "No" }, delta: -2, flag: "Attribution credibility gap." },
        { if: { "Are revenue forecasts accurate within 10%": "No" }, delta: -2, flag: "Forecast reliability risk." }
      ]
    },
    alignment_bands: [
      { min: 24, max: 30, label: "Structurally Aligned" },
      { min: 18, max: 23, label: "Operational Friction" },
      { min: 12, max: 17, label: "Strategic Leakage" },
      { min: 0, max: 11, label: "Structural Misalignment" }
    ]
  };
}

function normalizeKey(str) {
  return str.trim().toLowerCase().replace(/[?!.]+$/, "");
}

function normalizeValue(str) {
  return (str || "").trim().toLowerCase().replace(/[?.!]+$/, "");
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
    measurement: base
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
  const band = config.alignment_bands.find(b => total >= b.min && total <= b.max)?.label || "Unknown";

  const primaryConstraint = Object.keys(pillars).sort((a, b) => pillars[a] - pillars[b])[0];

  return { total, band, pillars, primaryConstraint, flags };
}

function renderExecSummary({ scored, clientName }) {
  const nicePillar = prettyPillar(scored.primaryConstraint);
  const topFlags = (scored.flags || []).slice(0, 2);

  const bodyText =
`Hi ${clientName || "there"},

Your Brand-to-GTM OS Executive Summary is ready.

Overall alignment: ${scored.band} (Score: ${scored.total}/25)
Primary constraint: ${nicePillar}

Key observations:
${topFlags.length ? topFlags.map(f => `- ${f}`).join("\n") : "- No major red flags detected from the structured inputs."}

Next step:
Reply to this email or book your 30-minute intro call to walk through the summary and learn more about the benefits of a full Brand-to-GTM OS diagnostic.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Executive Summary", bodyText };
}

function renderAudit({ scored, answers, clientName }) {
  const bodyText =
`Hi ${clientName || "there"},

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
${(scored.flags || []).length ? scored.flags.map(f => `- ${f}`).join("\n") : "- None detected from structured rules."}

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
    measurement: "Measurement"
  };
  return map[key] || key;
}