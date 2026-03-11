import fs from "fs";
import path from "path";
import { getReport } from "../lib/reportStore.js";
import { enrichAuditReport, enrichHiddenReport } from "../lib/enrichAudit.js";

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
if (tier === "hidden") {
  try {
    const aiInsights = await enrichHiddenReport(finalReportData);

    finalReportData = {
      ...finalReportData,
      constraint_hypothesis_summary:
        aiInsights?.constraint_hypothesis_summary || finalReportData.constraint_hypothesis_summary,
      constraint_hypothesis:
        aiInsights?.constraint_hypothesis || finalReportData.constraint_hypothesis || [],
      commercial_friction:
        aiInsights?.commercial_friction || finalReportData.commercial_friction || [],
      likely_objections:
        aiInsights?.likely_objections || finalReportData.likely_objections || [],
      discovery_questions:
        aiInsights?.discovery_questions || finalReportData.discovery_questions || [],
      conversation_strategy:
        aiInsights?.conversation_strategy || finalReportData.conversation_strategy || [],
      engagement_opportunities:
        aiInsights?.engagement_opportunities || finalReportData.engagement_opportunities || [],
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