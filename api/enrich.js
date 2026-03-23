// api/enrich.js
import { saveReport } from "../lib/reportStore.js";
import { enrichAuditReport, enrichHiddenReport } from "../lib/enrichAudit.js";

export const config = { maxDuration: 300 };

function prettyPillar(key) {
  const map = { positioning: "Positioning & Category", value_architecture: "Value Architecture", pricing_packaging: "Pricing & Packaging", gtm_focus: "GTM Focus", measurement: "Measurement" };
  return map[key] || key || null;
}

function getDynamicTargetPillarScores(normalizedAnswers, tier = "exec") {
  const acv = String(normalizedAnswers?.acv || "").toLowerCase();
  const cycle = String(normalizedAnswers?.sales_cycle || "").toLowerCase();
  const revenue = String(normalizedAnswers?.annual_revenue || "").toLowerCase();
  const model = String(normalizedAnswers?.revenue_model || "").toLowerCase();
  const isEnterprise = revenue.includes("100m+") || acv.includes("75–250") || acv.includes("75-250") || acv.includes("250k+");
  const isScaling = revenue.includes("25–50") || revenue.includes("25-50") || revenue.includes("10–25") || revenue.includes("10-25") || acv.includes("25–75") || acv.includes("25-75");
  let targets = isEnterprise
    ? { positioning: 16, value_architecture: 15, pricing_packaging: 15, gtm_focus: 15, measurement: 16 }
    : isScaling
    ? { positioning: 15, value_architecture: 14, pricing_packaging: 14, gtm_focus: 15, measurement: 14 }
    : { positioning: 14, value_architecture: 13, pricing_packaging: 13, gtm_focus: 14, measurement: 13 };
  if (cycle.includes("6–12") || cycle.includes("6-12") || cycle.includes("12+")) { targets.gtm_focus += 1; targets.measurement += 1; }
  if (model.includes("usage") || model.includes("hybrid")) targets.pricing_packaging += 1;
  if (tier === "audit" || tier === "hidden") targets = { positioning: Math.min(20, targets.positioning), value_architecture: Math.min(20, targets.value_architecture + 1), pricing_packaging: Math.min(20, targets.pricing_packaging + 1), gtm_focus: Math.min(20, targets.gtm_focus), measurement: Math.min(20, targets.measurement + 1) };
  return targets;
}

function getRadarLabels() {
  return { positioning: "Positioning", value_architecture: "Value", pricing_packaging: "Pricing", gtm_focus: "GTM", measurement: "Measurement" };
}

function buildAuditReportData(report) {
  const na = report?.inputs?.normalized_answers || {};
  const target = getDynamicTargetPillarScores(na, "audit");
  const radar = getRadarLabels();
  const pa = Array.isArray(report?.scoring?.pillar_scores) ? report.scoring.pillar_scores : [];
  const ft = report?.full_tier || {};
  const narr = report?.narrative || {};
  const es = narr?.executive_summary || {};
  return {
    company_name: report?.client?.company_name || "Company", contact_name: report?.client?.contact_name || "Client", website: report?.client?.website || "",
    report_date: report?.generated_at ? new Date(report.generated_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "",
    overall_score: report?.scoring?.overall_score ?? 0, score_band: report?.scoring?.band || "", confidence: report?.scoring?.confidence || "Moderate",
    primary_constraint_label: report?.scoring?.primary_constraint?.label || "",
    headline_diagnosis: narr?.headline_diagnosis || es?.headline || "", executive_summary_paragraph: es?.summary_paragraph || "", executive_headline: es?.headline || "",
    what_this_means_in_practice: narr?.what_this_means_in_practice || [], the_operating_tension: narr?.the_operating_tension || "",
    what_good_looks_like: narr?.what_good_looks_like || "", upgrade_bridge: narr?.upgrade_bridge || "",
    pillar_scores: { positioning: pa.find(p => p.key === "positioning")?.score ?? 0, value_architecture: pa.find(p => p.key === "value_architecture")?.score ?? 0, pricing_packaging: pa.find(p => p.key === "pricing_packaging")?.score ?? 0, gtm_focus: pa.find(p => p.key === "gtm_focus")?.score ?? 0, measurement: pa.find(p => p.key === "measurement")?.score ?? 0 },
    target_pillar_scores: target, radar_labels: radar, benchmark_context: { average_saas_company: 62, top_quartile: 78, elite_gtm_system: 85 },
    operating_tensions: narr?.operating_tensions?.slice(0, 5) || report?.scoring?.operating_tensions?.slice(0, 5) || [],
    swot: ft?.swot || null, root_cause_hypotheses: ft?.root_cause_hypotheses || [], constraint_chain: ft?.constraint_chain || [],
    competitive_context: ft?.competitive_context || null, pricing_packaging_audit: ft?.pricing_packaging_audit || null,
    roadmap: ft?.roadmap || null, constraint_analysis: ft?.constraint_analysis || null,
  };
}

function buildHiddenReportData(report) {
  const pa = Array.isArray(report?.scoring?.pillar_scores) ? report.scoring.pillar_scores : [];
  const ranked = [...pa].sort((a, b) => a.score - b.score);
  const pillarScores = {};
  pa.forEach(p => { pillarScores[p.key] = p.score; });
  const primary = ranked[0] || null;
  const na = report?.inputs?.normalized_answers || {};
  const target = getDynamicTargetPillarScores(na, "hidden");
  const radar = getRadarLabels();
  const rawChannels = na?.acquisition_channels;
  const primaryChannels = Array.isArray(rawChannels) ? rawChannels : typeof rawChannels === "string" ? rawChannels.split(",").map(s => s.trim()).filter(Boolean) : [];
  return {
    company_name: report?.client?.company_name || "Company", contact_name: report?.client?.contact_name || "Client",
    report_date: report?.generated_at ? new Date(report.generated_at).toLocaleDateString("en-US", { year: "numeric", month: "long" }) : "",
    diagnostic_snapshot: { annual_revenue: na?.annual_revenue || null, acv: na?.acv || null, sales_cycle: na?.sales_cycle || null, close_rate: na?.close_rate || null, primary_channels: primaryChannels, measurement_model: na?.marketing_measured_by || null, growth_status: na?.growth_status || null },
    benchmark_context: { average_saas_company: 62, top_quartile: 78, elite_gtm_system: 88 },
    scoring: { overall_score: report?.scoring?.overall_score || 0, score_band: report?.scoring?.band || "", confidence: report?.scoring?.confidence || "Moderate", pillar_scores: pillarScores, target_pillar_scores: target, radar_labels: radar, pillar_ranked: ranked.map(p => ({ key: p.key, label: p.label, score: p.score })), primary_constraint: primary ? { key: primary.key, label: primary.label, score: primary.score } : null },
    signal_analysis: { operating_tensions: report?.scoring?.operating_tensions || [], strength_signals: [], constraint_signals: [], risk_signals: (report?.scoring?.operating_tensions || []).slice(0, 3).map(c => c.implication), opportunity_signals: [] },
    interpretation: { executive_readout: "Initial diagnostic suggests the primary leverage point lies in improving the constraint most likely to suppress pricing power, differentiation, or GTM efficiency.", root_cause_hypotheses: (report?.scoring?.operating_tensions || []).slice(0, 3).map(c => c.implication) },
    call_briefing: report?.call_briefing || { opening_summary: "Begin by confirming where the commercial motion appears stronger than the proof, pricing, or measurement systems supporting it.", top_questions_to_ask: ["How do prospects typically evaluate ROI before purchasing?", "Where in the sales process do pricing objections appear?", "Which customer proof points most often move deals forward?"], areas_to_validate_live: ["Whether pricing tiers reflect actual customer value segments", "Whether sales messaging consistently leads with outcomes", "Whether attribution trust matches leadership expectations"] },
    consulting_opportunity: report?.consulting_opportunity || { likely_needs: ["Value architecture refinement", "Pricing and packaging strategy", "Messaging system alignment"], priority_engagement_angle: prettyPillar(report?.scoring?.primary_constraint?.key) || "Strategic Diagnostic Sprint", upsell_readiness: (report?.scoring?.overall_score || 0) <= 70 ? "High" : "Moderate" },
    headline_diagnosis: report?.narrative?.headline_diagnosis || "", executive_headline: report?.narrative?.executive_headline || "",
    the_operating_tension: report?.narrative?.the_operating_tension || "", what_this_means_in_practice: report?.narrative?.what_this_means_in_practice || [],
    diagnosis_implications: report?.diagnosis_implications || [], operating_tensions: report?.scoring?.operating_tensions || [],
    what_good_looks_like: report?.narrative?.what_good_looks_like || "", upgrade_bridge: report?.narrative?.upgrade_bridge || [],
    root_cause_hypotheses: report?.full_tier?.root_cause_hypotheses || [],
    swot: report?.full_tier?.swot || null,
    constraint_chain: report?.full_tier?.constraint_chain || [],
    competitive_context: report?.full_tier?.competitive_context || null,
    pricing_packaging_audit: report?.full_tier?.pricing_packaging_audit || null,
    roadmap: report?.full_tier?.roadmap || null,
    constraint_hypothesis_summary: report?.constraint_hypothesis_summary || "",
    constraint_hypothesis: report?.constraint_hypothesis || [],
    commercial_friction: report?.commercial_friction || [],
    likely_objections: report?.likely_objections || [],
    discovery_questions: report?.discovery_questions || [],
    conversation_strategy: report?.conversation_strategy || [],
    engagement_opportunities: report?.engagement_opportunities || [],
    pillar_scores: pillarScores, target_pillar_scores: target, radar_labels: radar, primary_constraint_label: primary?.label || "",
  };
}


export async function runEnrichment({ report, tier, auditReportId, hiddenReportId }) {
  console.log("[enrich] START tier=", tier, "hiddenId=", hiddenReportId);
  try {
    console.log("[enrich] Starting audit enrichment");
    const enriched = await enrichAuditReport(report);
    console.log("[enrich] Audit complete — swot:", !!enriched?.swot, "root_causes:", !!(enriched?.root_cause_hypotheses?.length), "roadmap:", !!enriched?.roadmap);
    if (!report.full_tier) report.full_tier = {};
    if (enriched?.full_tier) report.full_tier = { ...report.full_tier, ...enriched.full_tier };
    if (enriched?.swot) report.full_tier.swot = enriched.swot;
    if (enriched?.roadmap) report.full_tier.roadmap = { ...(report.full_tier.roadmap || {}), ...enriched.roadmap };
    if (enriched?.pricing_packaging_audit) report.full_tier.pricing_packaging_audit = { ...(report.full_tier.pricing_packaging_audit || {}), ...enriched.pricing_packaging_audit };
    if (enriched?.competitive_context) report.full_tier.competitive_context = { ...(report.full_tier.competitive_context || {}), ...enriched.competitive_context };
    if (enriched?.root_cause_hypotheses?.length) report.full_tier.root_cause_hypotheses = enriched.root_cause_hypotheses;
    if (enriched?.constraint_chain?.length) report.full_tier.constraint_chain = enriched.constraint_chain;
    if (enriched?.constraint_analysis) report.full_tier.constraint_analysis = enriched.constraint_analysis;
    if (!report.narrative) report.narrative = {};
    if (enriched?.narrative?.headline_diagnosis) report.narrative.headline_diagnosis = enriched.narrative.headline_diagnosis;
    if (enriched?.narrative?.what_this_means_in_practice?.length) report.narrative.what_this_means_in_practice = enriched.narrative.what_this_means_in_practice;
    if (enriched?.narrative?.the_operating_tension) report.narrative.the_operating_tension = enriched.narrative.the_operating_tension;
    if (enriched?.narrative?.what_good_looks_like) report.narrative.what_good_looks_like = enriched.narrative.what_good_looks_like;
    if (enriched?.headline_diagnosis && !report.narrative.headline_diagnosis) report.narrative.headline_diagnosis = enriched.headline_diagnosis;
    if (enriched?.what_this_means_in_practice?.length && !report.narrative.what_this_means_in_practice?.length) report.narrative.what_this_means_in_practice = enriched.what_this_means_in_practice;
    if (enriched?.the_operating_tension && !report.narrative.the_operating_tension) report.narrative.the_operating_tension = enriched.the_operating_tension;
    if (enriched?.what_good_looks_like && !report.narrative.what_good_looks_like) report.narrative.what_good_looks_like = enriched.what_good_looks_like;
    if (auditReportId) {
      try {
        const auditData = buildAuditReportData(report);
        await saveReport(auditReportId, { tier: "audit", reportData: auditData });
        console.log("[enrich] Audit report saved id=", auditReportId);
      } catch (e) { console.error("[enrich] AUDIT SAVE FAILED:", e.message); }
    }
    console.log("[enrich] Starting hidden enrichment");
    const hiddenEnriched = await enrichHiddenReport(report);
    console.log("[enrich] Hidden complete — hypothesis:", !!hiddenEnriched?.constraint_hypothesis_summary, "questions:", !!(hiddenEnriched?.discovery_questions?.length));
    if (hiddenEnriched?.constraint_hypothesis_summary) report.constraint_hypothesis_summary = hiddenEnriched.constraint_hypothesis_summary;
    if (hiddenEnriched?.constraint_hypothesis?.length) report.constraint_hypothesis = hiddenEnriched.constraint_hypothesis;
    if (hiddenEnriched?.commercial_friction?.length) report.commercial_friction = hiddenEnriched.commercial_friction;
    if (hiddenEnriched?.likely_objections?.length) report.likely_objections = hiddenEnriched.likely_objections;
    if (hiddenEnriched?.discovery_questions?.length) report.discovery_questions = hiddenEnriched.discovery_questions;
    if (hiddenEnriched?.conversation_strategy?.length) report.conversation_strategy = hiddenEnriched.conversation_strategy;
    if (hiddenEnriched?.engagement_opportunities?.length) report.engagement_opportunities = hiddenEnriched.engagement_opportunities;
    if (hiddenEnriched?.consulting_opportunity) report.consulting_opportunity = hiddenEnriched.consulting_opportunity;
    if (hiddenEnriched?.call_briefing) report.call_briefing = { ...(report.call_briefing || {}), ...hiddenEnriched.call_briefing };
    try {
      const hiddenData = buildHiddenReportData(report);
      await saveReport(hiddenReportId, { tier: "hidden", reportData: hiddenData });
      console.log("[enrich] Hidden report saved id=", hiddenReportId);
    } catch (e) { console.error("[enrich] HIDDEN SAVE FAILED:", e.message); }
    console.log("[enrich] ALL COMPLETE");
  } catch (err) {
    console.error("[enrich] FAILED:", err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const token = req.headers["x-vw-token"];
  if (!token || token !== process.env.VW_TOKEN) return res.status(401).json({ error: "Unauthorized" });

  const { report, tier, auditReportId, hiddenReportId } = req.body || {};
  console.log("[enrich] payload check — tier:", tier, "hasReport:", !!report, "hiddenReportId:", hiddenReportId, "auditReportId:", auditReportId);

  if (!report || !hiddenReportId) {
    console.log("[enrich] REJECTED — missing report or hiddenReportId");
    return res.status(400).json({ error: "Missing report or hiddenReportId" });
  }

  console.log("[enrich] START");

  try {
    // STEP 1: Audit enrichment — ALWAYS runs to populate slides 5-9
    console.log("[enrich] Starting audit enrichment (always runs)");
    const enriched = await enrichAuditReport(report);
    console.log("[enrich] Audit enrichment complete — swot:", !!enriched?.swot, "root_causes:", !!(enriched?.root_cause_hypotheses?.length), "roadmap:", !!enriched?.roadmap);

    if (!report.full_tier) report.full_tier = {};
    if (enriched?.full_tier) report.full_tier = { ...report.full_tier, ...enriched.full_tier };
    if (enriched?.swot) report.full_tier.swot = enriched.swot;
    if (enriched?.roadmap) report.full_tier.roadmap = { ...(report.full_tier.roadmap || {}), ...enriched.roadmap };
    if (enriched?.pricing_packaging_audit) report.full_tier.pricing_packaging_audit = { ...(report.full_tier.pricing_packaging_audit || {}), ...enriched.pricing_packaging_audit };
    if (enriched?.competitive_context) report.full_tier.competitive_context = { ...(report.full_tier.competitive_context || {}), ...enriched.competitive_context };
    if (enriched?.root_cause_hypotheses?.length) report.full_tier.root_cause_hypotheses = enriched.root_cause_hypotheses;
    if (enriched?.constraint_chain?.length) report.full_tier.constraint_chain = enriched.constraint_chain;
    if (enriched?.constraint_analysis) report.full_tier.constraint_analysis = enriched.constraint_analysis;

    if (!report.narrative) report.narrative = {};
    if (enriched?.narrative?.headline_diagnosis) report.narrative.headline_diagnosis = enriched.narrative.headline_diagnosis;
    if (enriched?.narrative?.what_this_means_in_practice?.length) report.narrative.what_this_means_in_practice = enriched.narrative.what_this_means_in_practice;
    if (enriched?.narrative?.the_operating_tension) report.narrative.the_operating_tension = enriched.narrative.the_operating_tension;
    if (enriched?.narrative?.what_good_looks_like) report.narrative.what_good_looks_like = enriched.narrative.what_good_looks_like;
    if (enriched?.headline_diagnosis && !report.narrative.headline_diagnosis) report.narrative.headline_diagnosis = enriched.headline_diagnosis;
    if (enriched?.what_this_means_in_practice?.length && !report.narrative.what_this_means_in_practice?.length) report.narrative.what_this_means_in_practice = enriched.what_this_means_in_practice;
    if (enriched?.the_operating_tension && !report.narrative.the_operating_tension) report.narrative.the_operating_tension = enriched.the_operating_tension;
    if (enriched?.what_good_looks_like && !report.narrative.what_good_looks_like) report.narrative.what_good_looks_like = enriched.what_good_looks_like;

    if (auditReportId) {
      try {
        const auditData = buildAuditReportData(report);
        await saveReport(auditReportId, { tier: "audit", reportData: auditData });
        console.log("[enrich] Audit report saved to Redis id=", auditReportId);
      } catch (e) { console.error("[enrich] AUDIT SAVE FAILED:", e.message); }
    }

    // STEP 2: Hidden enrichment — populates slides 11-13
    console.log("[enrich] Starting hidden enrichment");
    const hiddenEnriched = await enrichHiddenReport(report);
    console.log("[enrich] Hidden enrichment complete — hypothesis:", !!hiddenEnriched?.constraint_hypothesis_summary, "questions:", !!(hiddenEnriched?.discovery_questions?.length));

    if (hiddenEnriched?.constraint_hypothesis_summary) report.constraint_hypothesis_summary = hiddenEnriched.constraint_hypothesis_summary;
    if (hiddenEnriched?.constraint_hypothesis?.length) report.constraint_hypothesis = hiddenEnriched.constraint_hypothesis;
    if (hiddenEnriched?.commercial_friction?.length) report.commercial_friction = hiddenEnriched.commercial_friction;
    if (hiddenEnriched?.likely_objections?.length) report.likely_objections = hiddenEnriched.likely_objections;
    if (hiddenEnriched?.discovery_questions?.length) report.discovery_questions = hiddenEnriched.discovery_questions;
    if (hiddenEnriched?.conversation_strategy?.length) report.conversation_strategy = hiddenEnriched.conversation_strategy;
    if (hiddenEnriched?.engagement_opportunities?.length) report.engagement_opportunities = hiddenEnriched.engagement_opportunities;
    if (hiddenEnriched?.consulting_opportunity) report.consulting_opportunity = hiddenEnriched.consulting_opportunity;
    if (hiddenEnriched?.call_briefing) report.call_briefing = { ...(report.call_briefing || {}), ...hiddenEnriched.call_briefing };

    // STEP 3: Save hidden report AFTER both enrichments complete
    try {
      const hiddenData = buildHiddenReportData(report);
      await saveReport(hiddenReportId, { tier: "hidden", reportData: hiddenData });
      console.log("[enrich] Hidden report saved to Redis id=", hiddenReportId);
    } catch (e) { console.error("[enrich] HIDDEN SAVE FAILED:", e.message); }

    console.log("[enrich] ALL COMPLETE");
  } catch (err) {
    console.error("[enrich] FAILED:", err.message);
  }

  res.status(200).json({ status: "enrichment complete" });
}
