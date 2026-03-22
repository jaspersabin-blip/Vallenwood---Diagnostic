// api/report.js
// Reads report data from Redis and injects it into the HTML template.
// Does NOT call any enrichment functions — all enrichment happens in
// diagnostic.js background process after the Zapier response is sent.

import fs from "fs";
import path from "path";
import { getReport } from "../lib/reportStore.js";

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
  const source =
    reportData?.pillar_scores ??
    reportData?.scoring?.pillar_scores ??
    [];

  // Supports object form
  if (source && !Array.isArray(source) && typeof source === "object") {
    return {
      positioning: Number(source.positioning || 0),
      value_architecture: Number(source.value_architecture || 0),
      pricing_packaging: Number(source.pricing_packaging || 0),
      gtm_focus: Number(source.gtm_focus || 0),
      measurement: Number(source.measurement || 0),
    };
  }

  // Supports array form
  const arr = Array.isArray(source) ? source : [];
  return {
    positioning: Number(arr.find((p) => p.key === "positioning")?.score || 0),
    value_architecture: Number(arr.find((p) => p.key === "value_architecture")?.score || 0),
    pricing_packaging: Number(arr.find((p) => p.key === "pricing_packaging")?.score || 0),
    gtm_focus: Number(arr.find((p) => p.key === "gtm_focus")?.score || 0),
    measurement: Number(arr.find((p) => p.key === "measurement")?.score || 0),
  };
}

function splitRadarLabel(label) {
  const text = String(label || "").trim();
  if (!text) return [""];
  if (text.length <= 12) return [text];
  if (text.includes(" & ")) {
    const [left, right] = text.split(" & ");
    return [`${left} &`, right];
  }
  const words = text.split(/\s+/);
  if (words.length === 1) return [text];
  if (words.length === 2) return words;
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

    // Select the correct HTML template for this tier
    let templatePath;
    if (tier === "audit") {
      templatePath = path.join(process.cwd(), "reports", "audit-report.html");
    } else if (tier === "hidden") {
      templatePath = path.join(process.cwd(), "reports", "hidden-report.html");
    } else {
      templatePath = path.join(process.cwd(), "reports", "exec-report.html");
    }

    // Normalize data for chart and template consumption
    // No enrichment here — enrichment runs in diagnostic.js background process
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