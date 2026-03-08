import fs from "fs";
import path from "path";
import { getReport } from "../lib/reportStore.js";

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
    const reportData = stored.reportData || stored;

    let templatePath;
    if (tier === "audit") {
      templatePath = path.join(process.cwd(), "reports", "audit-report.html");
    } else {
      templatePath = path.join(process.cwd(), "reports", "exec-report.html");
    }

    const html = fs.readFileSync(templatePath, "utf8");
    const injection = `<script>window.REPORT_DATA = ${JSON.stringify(reportData)};</script>`;

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