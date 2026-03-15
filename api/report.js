import fs from "fs";
import path from "path";
import { getReport } from "../lib/reportStore.js";
import { enrichAuditReport, enrichHiddenReport } from "../lib/enrichAudit.js";

function getDefaultRadarLabels() {
  return {
    positioning: "Positioning",
    value_architecture: "Value Architecture",
    pricing_packaging: "Pricing & Packaging",
    gtm_focus: "GTM Focus",
    measurement: "Measurement",
  };
}

function getDefaultTargetScores() {
  return {
    positioning: 16,
    value_architecture: 15,
    pricing_packaging: 15,
    gtm_focus: 16,
    measurement: 15,
  };
}

function getPillarScoreObject(reportData) {
  // Supports either object form or array form
  if (reportData?.pillar_scores && !Array.isArray(reportData.pillar_scores)) {
    return {
      positioning: Number(reportData.pillar_scores.positioning || 0),
      value_architecture: Number(reportData.pillar_scores.value_architecture || 0),
      pricing_packaging: Number(reportData.pillar_scores.pricing_packaging || 0),
      gtm_focus: Number(reportData.pillar_scores.gtm_focus || 0),
      measurement: Number(reportData.pillar_scores.measurement || 0),
    };
  }

  const arr = Array.isArray(reportData?.pillar_scores) ? reportData.pillar_scores : [];

  return {
    positioning: Number(arr.find((p) => p.key === "positioning")?.score || 0),
    value_architecture: Number(arr.find((p) => p.key === "value_architecture")?.score || 0),
    pricing_packaging: Number(arr.find((p) => p.key === "pricing_packaging")?.score || 0),
    gtm_focus: Number(arr.find((p) => p.key === "gtm_focus")?.score || 0),
    measurement: Number(arr.find((p) => p.key === "measurement")?.score || 0),
  };
}

/**
 * Splits long radar labels into multi-line arrays for Chart.js pointLabels.
 * Example:
 * "Value Architecture" => ["Value", "Architecture"]
 * "Pricing & Packaging" => ["Pricing &", "Packaging"]
 */
function splitRadarLabel(label) {
  const text = String(label || "").trim();
  if (!text) return [""];

  // Keep short labels on one line
  if (text.length <= 12) return [text];

  // Prefer natural split points
  if (text.includes(" & ")) {
    const [left, right] = text.split(" & ");
    return [`${left} &`, right];
  }

  const words = text.split(/\s+/);

  if (words.length === 1) return [text];
  if (words.length === 2) return words;

  // Balance multi-word labels into 2 lines
  const midpoint = Math.ceil(words.length / 2);
  return [words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" ")];
}

function getChartOptions(reportData) {
  const custom = reportData?.chart_options || reportData?.scoring?.chart_options || {};

  return {
    responsive: true,
    maintainAspectRatio: false,
    layoutPadding: 28,
    maxValue: 20,
    minValue: 0,
    tickStepSize: 5,
    pointLabelFontSize: 11,
    pointLabelPadding: 18,
    datasetBorderWidth: 2,
    datasetPointRadius: 2,
    ...custom,
  };
}

function normalizeReportDataForTemplate(reportData, tier) {
  const radarLabels = {
    ...getDefaultRadarLabels(),
    ...(reportData?.radar_labels || reportData?.scoring?.radar_labels || {}),
  };

  const targetPillarScores = {
    ...getDefaultTargetScores(),
    ...(reportData?.target_pillar_scores || reportData?.scoring?.target_pillar_scores || {}),
  };

  const pillarScores = getPillarScoreObject(reportData);
  const chartOptions = getChartOptions(reportData);

  const radarLabelArray = [
    radarLabels.positioning,
    radarLabels.value_architecture,
    radarLabels.pricing_packaging,
    radarLabels.gtm_focus,
    radarLabels.measurement,
  ];

  const radarLabelMultiLineArray = radarLabelArray.map(splitRadarLabel);

  const actualScoreArray = [
    pillarScores.positioning,
    pillarScores.value_architecture,
    pillarScores.pricing_packaging,
    pillarScores.gtm_focus,
    pillarScores.measurement,
  ];

  const targetScoreArray = [
    targetPillarScores.positioning,
    targetPillarScores.value_architecture,
    targetPillarScores.pricing_packaging,
    targetPillarScores.gtm_focus,
    targetPillarScores.measurement,
  ];

  const normalized = {
    ...reportData,

    radar_labels: radarLabels,
    target_pillar_scores: targetPillarScores,
    pillar_scores: pillarScores,
    chart_options: chartOptions,

    chart: {
      labels: radarLabelArray,
      multiline_labels: radarLabelMultiLineArray,
      actual_scores: actualScoreArray,
      target_scores: targetScoreArray,
      options: chartOptions,
    },

    // Aliases for template compatibility
    radar_label_array: radarLabelArray,
    radar_label_multiline_array: radarLabelMultiLineArray,
    pillar_score_array: actualScoreArray,
    target_score_array: targetScoreArray,
  };

  if (tier === "hidden") {
    normalized.scoring = {
      ...(normalized.scoring || {}),
      radar_labels: radarLabels,
      target_pillar_scores: targetPillarScores,
      pillar_scores: pillarScores,
      chart_options: chartOptions,
      chart: {
        labels: radarLabelArray,
        multiline_labels: radarLabelMultiLineArray,
        actual_scores: actualScoreArray,
        target_scores: targetScoreArray,
        options: chartOptions,
      },
    };
  }

  return normalized;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("GET only");
    }

    const reportId = String(req.query.id || "").trim();
    const requestedTier = String(req.query.tier || "").trim().toLowerCase();

    if (!reportId) {
      return res.status(400).send("Missing report id");
    }

    const stored = await getReport(reportId);
    if (!stored) {
      return res.status(404).send("Report not found");
    }

    const tier = requestedTier || stored.tier || "exec";
    let finalReportData = stored.reportData || stored;

    let templatePath;
    if (tier === "audit") {
      templatePath = path.join(process.cwd(), "reports", "audit-report.html");
    } else if (tier === "hidden") {
      templatePath = path.join(process.cwd(), "reports", "hidden-report.html");
    } else {
      templatePath = path.join(process.cwd(), "reports", "exec-report.html");
    }

    if (tier === "audit") {
      try {
        const aiInsights = await enrichAuditReport(finalReportData);

        finalReportData = {
          ...finalReportData,
          swot: aiInsights?.swot || finalReportData.swot,
          competitive_context:
            aiInsights?.competitive_context || finalReportData.competitive_context,
          pricing_packaging_audit: {
            ...(finalReportData.pricing_packaging_audit || {}),
            ...(aiInsights?.pricing_insight || {}),
          },
          roadmap: {
            ...(finalReportData.roadmap || {}),
            ...(aiInsights?.roadmap || {}),
          },
          constraint_analysis: {
            ...(finalReportData.constraint_analysis || {}),
            ...(aiInsights?.constraint_analysis || {}),
          },
        };
      } catch (err) {
        console.error("[report] Audit enrichment failed:", err);
      }
    }

    if (tier === "hidden") {
      try {
        const aiInsights = await enrichHiddenReport(finalReportData);

        finalReportData = {
          ...finalReportData,
          constraint_hypothesis_summary:
            aiInsights?.constraint_hypothesis_summary ||
            finalReportData.constraint_hypothesis_summary,
          constraint_hypothesis:
            aiInsights?.constraint_hypothesis ||
            finalReportData.constraint_hypothesis ||
            [],
          commercial_friction:
            aiInsights?.commercial_friction ||
            finalReportData.commercial_friction ||
            [],
          likely_objections:
            aiInsights?.likely_objections ||
            finalReportData.likely_objections ||
            [],
          discovery_questions:
            aiInsights?.discovery_questions ||
            finalReportData.discovery_questions ||
            [],
          conversation_strategy:
            aiInsights?.conversation_strategy ||
            finalReportData.conversation_strategy ||
            [],
          engagement_opportunities:
            aiInsights?.engagement_opportunities ||
            finalReportData.engagement_opportunities ||
            [],
          consulting_opportunity: {
            ...(finalReportData.consulting_opportunity || {}),
            ...(aiInsights?.consulting_opportunity || {}),
          },
          call_briefing: {
            ...(finalReportData.call_briefing || {}),
            ...(aiInsights?.call_briefing || {}),
          },
        };
      } catch (err) {
        console.error("[report] Hidden enrichment failed:", err);
      }
    }

    // Normalize data for chart/template consumption
    finalReportData = normalizeReportDataForTemplate(finalReportData, tier);

    const html = fs.readFileSync(templatePath, "utf8");
    const injection = `<script>window.REPORT_DATA = ${JSON.stringify(finalReportData)};</script>`;

    const injected = html.includes("</head>")
      ? html.replace("</head>", `  ${injection}\n</head>`)
      : `${injection}\n${html}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(injected);
  } catch (err) {
    console.error("[report] Unhandled error:", err);
    return res.status(500).send(`Server error: ${err.message}`);
  }
}