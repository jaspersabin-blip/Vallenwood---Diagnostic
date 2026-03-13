// lib/scoring.js
// Brand-to-GTM OS scoring engine (consulting-calibrated)
// Uses normalized snake_case keys from api/diagnostic.js

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asString(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value).trim();
}

function lower(value) {
  return asString(value).toLowerCase();
}

function includesAny(value, needles = []) {
  const v = lower(value);
  return needles.some((n) => v.includes(String(n).toLowerCase()));
}

function safeArray(value) {
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/,|\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function scorePositioning(inputs) {
  let score = 6;

  const win = lower(inputs.win_reason);
  const lose = lower(inputs.lose_reason);
  const consistency = lower(inputs.consistency);
  const comparedTo = lower(inputs.compared_to);
  const category = lower(inputs.category);

  // Win reason
  if (includesAny(win, ["clear differentiation"])) score += 6;
  else if (includesAny(win, ["brand trust"])) score += 5;
  else if (includesAny(win, ["feature depth"])) score += 4;
  else if (includesAny(win, ["speed", "ease of use"])) score += 4;
  else if (includesAny(win, ["product breadth"])) score += 5;
  else if (includesAny(win, ["strong relationships", "relationships"])) score += 2;
  else if (includesAny(win, ["lowest price", "price"])) score += 1;

  // Loss reason (higher score here means a healthier loss pattern)
  if (includesAny(lose, ["price"])) score += 5;
  else if (includesAny(lose, ["feature gaps"])) score += 4;
  else if (includesAny(lose, ["procurement friction"])) score += 3;
  else if (includesAny(lose, ["brand trust"])) score += 2;
  else if (includesAny(lose, ["unclear roi"])) score += 2;
  else if (includesAny(lose, ["lack of differentiation", "category confusion"])) score += 1;

  // Messaging consistency
  if (includesAny(consistency, ["very consistent"])) score += 7;
  else if (includesAny(consistency, ["somewhat"])) score += 4;
  else if (includesAny(consistency, ["often unclear", "unclear"])) score += 1;

  // Small maturity bonus for clearly defined competitive set / category
  if (comparedTo && category) score += 1;

  return clamp(score, 0, 20);
}

function scoreValue(inputs) {
  let score = 5;

  const roi = lower(inputs.roi_quantifiable);
  const lead = lower(inputs.sales_lead_with);
  const metrics = lower(inputs.financial_metrics_improved);

  if (includesAny(roi, ["documented", "repeatable", "yes"])) score += 7;
  else if (includesAny(roi, ["somewhat"])) score += 4;
  else if (includesAny(roi, ["no"])) score += 1;

  if (includesAny(lead, ["financial roi"])) score += 6;
  else if (includesAny(lead, ["business outcomes"])) score += 5;
  else if (includesAny(lead, ["technical differentiation"])) score += 4;
  else if (includesAny(lead, ["features"])) score += 2;

  if (includesAny(metrics, ["revenue growth", "margin expansion"])) score += 5;
  else if (includesAny(metrics, ["cost reduction"])) score += 4;
  else if (includesAny(metrics, ["risk reduction"])) score += 4;
  else if (includesAny(metrics, ["productivity gains"])) score += 3;
  else if (includesAny(metrics, ["not clearly defined"])) score += 1;

  return clamp(score, 0, 20);
}

function scorePricing(inputs) {
  let score = 5;

  const discount = lower(inputs.discount_frequency);
  const clarity = lower(inputs.pricing_tiers_clarity);
  const margin = lower(inputs.gross_margin);

  // Softer discount penalties than old model
  if (includesAny(discount, ["rarely"])) score += 5;
  else if (includesAny(discount, ["sometimes"])) score += 3;
  else if (includesAny(discount, ["frequently", "often", "40%+"])) score += 1;

  if (includesAny(clarity, ["very clear"])) score += 5;
  else if (includesAny(clarity, ["somewhat", "clear"])) score += 3;
  else if (includesAny(clarity, ["often confused", "confused"])) score += 1;

  if (includesAny(margin, ["75%+"])) score += 5;
  else if (includesAny(margin, ["65–75%", "65-75%"])) score += 4;
  else if (includesAny(margin, ["50–65%", "50-65%"])) score += 3;
  else if (includesAny(margin, ["under 50%"])) score += 1;

  return clamp(score, 0, 20);
}

function scoreGtm(inputs) {
  let score = 4;

  const channels = safeArray(inputs.acquisition_channels).map((c) => c.toLowerCase());
  const cycle = lower(inputs.sales_cycle);
  const closeRate = lower(inputs.close_rate);

  let channelScore = 0;
  channels.slice(0, 3).forEach((ch) => {
    if (includesAny(ch, ["partnerships"])) channelScore += 3;
    else if (includesAny(ch, ["content"])) channelScore += 3;
    else if (includesAny(ch, ["product-led"])) channelScore += 3;
    else if (includesAny(ch, ["outbound sdr"])) channelScore += 2;
    else if (includesAny(ch, ["founder-led selling"])) channelScore += 2;
    else if (includesAny(ch, ["events"])) channelScore += 2;
    else if (includesAny(ch, ["paid search"])) channelScore += 1;
    else if (includesAny(ch, ["paid social"])) channelScore += 1;
  });

  score += clamp(channelScore, 0, 8);

  if (includesAny(cycle, ["under 1 month"])) score += 6;
  else if (includesAny(cycle, ["1–3 months", "1-3 months"])) score += 5;
  else if (includesAny(cycle, ["3–6 months", "3-6 months"])) score += 4;
  else if (includesAny(cycle, ["6–12 months", "6-12 months"])) score += 3;
  else if (includesAny(cycle, ["12+ months"])) score += 2;

  if (includesAny(closeRate, ["40%+"])) score += 6;
  else if (includesAny(closeRate, ["25–40%", "25-40%"])) score += 5;
  else if (includesAny(closeRate, ["15–25%", "15-25%"])) score += 4;
  else if (includesAny(closeRate, ["under 15%"])) score += 2;

  return clamp(score, 0, 20);
}

function scoreMeasurement(inputs) {
  let score = 4;

  const measuredBy = lower(inputs.marketing_measured_by);
  const attribution = lower(inputs.attribution_trusted);
  const forecast = lower(inputs.forecast_accuracy);
  const cac = lower(inputs.cac_by_channel);

  if (includesAny(measuredBy, ["revenue"])) score += 6;
  else if (includesAny(measuredBy, ["pipeline"])) score += 5;
  else if (includesAny(measuredBy, ["brand metrics"])) score += 3;
  else if (includesAny(measuredBy, ["leads"])) score += 2;

  if (includesAny(attribution, ["yes"])) score += 6;
  else if (includesAny(attribution, ["debated"])) score += 4;
  else if (includesAny(attribution, ["no"])) score += 1;

  if (includesAny(forecast, ["yes"])) score += 4;
  else if (includesAny(forecast, ["no"])) score += 1;

  if (includesAny(cac, ["yes"])) score += 4;
  else if (includesAny(cac, ["rough estimates"])) score += 3;
  else if (includesAny(cac, ["no"])) score += 1;

  return clamp(score, 0, 20);
}

function applyHeuristics(inputs, scores) {
  const revenue = lower(inputs.annual_revenue);
  const acv = lower(inputs.acv);
  const cycle = lower(inputs.sales_cycle);
  const discount = lower(inputs.discount_frequency);
  const clarity = lower(inputs.pricing_tiers_clarity);
  const win = lower(inputs.win_reason);
  const forecast = lower(inputs.forecast_accuracy);
  const roi = lower(inputs.roi_quantifiable);
  const attribution = lower(inputs.attribution_trusted);
  const growth = lower(inputs.growth_status);

  // GTM efficiency
  if (includesAny(acv, ["$25–75k", "$25-75k", "25–75", "25-75"]) && includesAny(cycle, ["1–3 months", "1-3 months"])) {
    scores.gtm += 2;
  }
  if (includesAny(acv, ["$75–250k", "$75-250k", "75–250", "75-250"]) && includesAny(cycle, ["3–6 months", "3-6 months"])) {
    scores.gtm += 1;
  }
  if (includesAny(acv, ["$250k+", "250k+"]) && includesAny(cycle, ["6–12 months", "6-12 months"])) {
    scores.gtm += 1;
  }

  // Enterprise maturity
  if (includesAny(revenue, ["$100m+", "100m+"])) {
    scores.measurement += 2;
    scores.gtm += 1;
  }

  // Pricing power signal
  if (includesAny(discount, ["rarely"]) && includesAny(clarity, ["very clear"])) {
    scores.pricing += 2;
  }

  // Mature brand / category signal
  if (includesAny(win, ["brand trust"]) && includesAny(revenue, ["$100m+", "100m+"])) {
    scores.positioning += 2;
  }

  // Outcome maturity
  if (includesAny(roi, ["documented", "repeatable"]) && includesAny(attribution, ["yes"])) {
    scores.value += 1;
    scores.measurement += 1;
  }

  // Forecast credibility bonus
  if (includesAny(forecast, ["yes"])) {
    scores.measurement += 1;
  }

  // Plateau penalty when maturity signals are weak
  if (includesAny(growth, ["plateau", "stalled"]) && scores.positioning < 14) {
    scores.positioning -= 1;
  }

  scores.positioning = clamp(scores.positioning, 0, 20);
  scores.value = clamp(scores.value, 0, 20);
  scores.pricing = clamp(scores.pricing, 0, 20);
  scores.gtm = clamp(scores.gtm, 0, 20);
  scores.measurement = clamp(scores.measurement, 0, 20);

  return scores;
}

function detectContradictions(inputs, scores) {
  const contradictions = [];

  const roi = lower(inputs.roi_quantifiable);
  const salesLead = lower(inputs.sales_lead_with);
  const pricing = lower(inputs.pricing_tiers_clarity);
  const discount = lower(inputs.discount_frequency);
  const consistency = lower(inputs.consistency);
  const attribution = lower(inputs.attribution_trusted);
  const forecast = lower(inputs.forecast_accuracy);
  const growth = lower(inputs.growth_status);
  const cac = lower(inputs.cac_by_channel);
  const measureBy = lower(inputs.marketing_measured_by);
  const revenue = lower(inputs.annual_revenue);
  const win = lower(inputs.win_reason);
  const lose = lower(inputs.lose_reason);

  if (includesAny(salesLead, ["business outcomes", "financial roi"]) && !includesAny(roi, ["yes", "documented", "repeatable"])) {
    contradictions.push({
      id: "outcomes_without_proof",
      tension: "Outcome-led selling without strong ROI proof",
      implication:
        "The team is trying to sell on value, but quantified proof may be too weak to consistently support pricing power and conversion.",
      pillar: "Value Architecture",
      severity: 3,
    });
  }

  if ((includesAny(pricing, ["very clear", "somewhat", "clear"])) && includesAny(discount, ["sometimes", "frequently", "often"])) {
    contradictions.push({
      id: "clear_pricing_discount_pressure",
      tension: "Clear packaging but persistent discount pressure",
      implication:
        "Customers may understand the offer structure, but the system may still lack enough value anchoring or differentiation to defend price.",
      pillar: "Pricing & Packaging",
      severity: 3,
    });
  }

  if (includesAny(consistency, ["very consistent"]) && includesAny(lose, ["price"])) {
    contradictions.push({
      id: "consistent_message_still_losing_on_price",
      tension: "Consistent messaging without pricing insulation",
      implication:
        "The brand may be understood, but the value story may still not be strong enough to protect margin in competitive deals.",
      pillar: "Pricing & Packaging",
      severity: 2,
    });
  }

  if (includesAny(measureBy, ["revenue"]) && includesAny(attribution, ["debated"])) {
    contradictions.push({
      id: "revenue_focus_attribution_gap",
      tension: "Revenue accountability without trusted attribution",
      implication:
        "Marketing is being held to revenue outcomes without a fully trusted system for proving contribution.",
      pillar: "Measurement",
      severity: 3,
    });
  }

  if (includesAny(revenue, ["$100m+", "100m+"]) && !includesAny(cac, ["yes"])) {
    contradictions.push({
      id: "scale_without_cac_visibility",
      tension: "Scale-stage business with incomplete CAC visibility",
      implication:
        "The company may have grown into a level of complexity that now requires stronger channel economics discipline.",
      pillar: "Measurement",
      severity: 2,
    });
  }

  if (includesAny(forecast, ["yes"]) && includesAny(attribution, ["debated"])) {
    contradictions.push({
      id: "forecasting_without_attribution_alignment",
      tension: "Forecast confidence without measurement alignment",
      implication:
        "The business may forecast top-line performance reasonably well while still lacking trusted visibility into what is driving it.",
      pillar: "Measurement",
      severity: 2,
    });
  }

  if (includesAny(growth, ["plateau", "stalled"]) && scores.measurement >= 15 && scores.gtm >= 15) {
    contradictions.push({
      id: "plateau_despite_operating_discipline",
      tension: "Operational discipline without growth acceleration",
      implication:
        "Execution may be functioning, but positioning, value communication, or category differentiation may be constraining growth.",
      pillar: "Positioning & Category",
      severity: 3,
    });
  }

  if (includesAny(win, ["feature depth"]) && includesAny(salesLead, ["features"])) {
    contradictions.push({
      id: "feature_loop",
      tension: "Feature-led commercial motion may suppress pricing power",
      implication:
        "The system may be reinforcing product depth without translating that depth into higher-order business value.",
      pillar: "Value Architecture",
      severity: 2,
    });
  }

  return contradictions;
}

function getConfidenceLevel(contradictions) {
  const totalSeverity = contradictions.reduce((sum, c) => sum + (c.severity || 0), 0);
  if (totalSeverity <= 2) return "High";
  if (totalSeverity <= 5) return "Moderate";
  return "Lower";
}

function determinePrimaryConstraint(scores, contradictions) {
  const candidates = [
    { key: "Positioning & Category", score: scores.positioning, bias: 0 },
    { key: "Value Architecture", score: scores.value, bias: 0 },
    { key: "Pricing & Packaging", score: scores.pricing, bias: 0 },
    { key: "GTM Focus", score: scores.gtm, bias: 0 },
    { key: "Measurement", score: scores.measurement, bias: 0 },
  ];

  contradictions.forEach((c) => {
    const target = candidates.find((item) => item.key === c.pillar);
    if (target) target.bias += c.severity || 0;
  });

  candidates.sort((a, b) => (a.score - a.bias) - (b.score - b.bias));
  return candidates[0].key;
}

export function scoreDiagnostic(inputs = {}) {
  const scores = {
    positioning: scorePositioning(inputs),
    value: scoreValue(inputs),
    pricing: scorePricing(inputs),
    gtm: scoreGtm(inputs),
    measurement: scoreMeasurement(inputs),
  };

  applyHeuristics(inputs, scores);

  const contradictions = detectContradictions(inputs, scores);
  const contradictionPenalty = Math.min(
    4,
    contradictions.reduce((sum, c) => sum + (c.severity >= 3 ? 1 : 0), 0)
  );

  const rawScore =
    scores.positioning +
    scores.value +
    scores.pricing +
    scores.gtm +
    scores.measurement;

  const adjustedRawScore = rawScore - contradictionPenalty;

  const osScore = clamp(
    Math.round((adjustedRawScore - 40) * 1.35 + 40),
    35,
    95
  );

  const confidence = getConfidenceLevel(contradictions);
  const primaryConstraint = determinePrimaryConstraint(scores, contradictions);

  return {
    scores: {
      positioning: clamp(scores.positioning, 0, 20),
      value: clamp(scores.value, 0, 20),
      pricing: clamp(scores.pricing, 0, 20),
      gtm: clamp(scores.gtm, 0, 20),
      measurement: clamp(scores.measurement, 0, 20),
    },
    rawScore,
    adjustedRawScore,
    osScore,
    confidence,
    contradictions,
    contradictionPenalty,
    primaryConstraint,
  };
}