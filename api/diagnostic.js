// api/diagnostic.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Simple auth so random people can’t hit your endpoint
  const token = req.headers["x-vw-token"];
  if (!token || token !== process.env.VW_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.body || {};
  const answers = payload.answers || {};
  const tier = payload.tier || "exec"; // "exec" | "audit"
  const clientEmail = payload.client_email || "";
  const clientName = payload.client_name || "";

  const config = getConfig();

  const scored = score(answers, config);

  const content =
    tier === "audit"
      ? renderAudit({ scored, answers, clientName })
      : renderExecSummary({ scored, answers, clientName });

  return res.status(200).json({
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

function score(answers, config) {
  const base = config.pillar_base_score;

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
      if ((answers[field] || "").trim() === expected) {
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
Reply to this email or book your 30-minute intro call to walk through the findings and decide whether a full Strategic Audit ($499) is warranted.

— Jasper
`;

  return { subject: "Your Brand-to-GTM OS Executive Summary", bodyText };
}

function renderAudit({ scored, answers, clientName }) {
  // This is a v1 “full audit” as a detailed text report.
  // Later we can upgrade to PDF output.
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
