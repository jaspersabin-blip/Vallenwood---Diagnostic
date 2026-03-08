import fs from "fs";
import path from "path";

function decodePayload(payload) {
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("GET only");
    }

    const tier = String(req.query.tier || "exec").toLowerCase();
    const payload = req.query.payload;

    if (!payload || typeof payload !== "string") {
      return res.status(400).send("Missing payload");
    }

    const reportData = decodePayload(payload);
    if (!reportData) {
      return res.status(400).send("Invalid payload");
    }

    let templatePath;
    if (tier === "exec") {
      templatePath = path.join(process.cwd(), "reports", "exec-report.html");
    } else {
      return res.status(400).send("Unsupported tier");
    }

    const html = fs.readFileSync(templatePath, "utf8");

    const injection = `<script>window.REPORT_DATA = ${JSON.stringify(reportData)};</script>`;

    let injected;
    if (html.includes("</head>")) {
      injected = html.replace("</head>", `  ${injection}\n</head>`);
    } else {
      injected = `${injection}\n${html}`;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(injected);
  } catch (err) {
    console.error("[report] Unhandled error:", err);
    return res.status(500).send(`Server error: ${err.message}`);
  }
}