// scripts/smoke-test.js
// Smoke test for /api/diagnostic endpoint.
// Usage: VW_TOKEN=your_token npm run smoke:test

const url = process.env.DIAGNOSTIC_URL || "http://localhost:3000/api/diagnostic";
const token = process.env.VW_TOKEN;

if (!token) {
  console.error("FAIL: VW_TOKEN environment variable is not set.");
  process.exit(1);
}

const payload = {
  client_name: "Smoke Test Client",
  client_email: "smoke@example.com",
  client_company: "Smoke Test Co",
  client_website: "smoketest.com",
  tier: "audit",
  answers: {
    "Annual Revenue": "$10-25M",
    "Primary Revenue Model": "Subscription (SaaS)",
    "Average Contract Value (ACV)": "$25-75K",
    "Average Sales Cycle Length": "3-6 months",
    "Close Rate (%)": "25-40%",
    "What category do you compete in?": "B2B Marketing Software",
    "Who do customers compare you to most often?": "HubSpot, Marketo",
    "Why do you most often win deals?": "Clear differentiation",
    "Why do you most often lose deals?": "Price",
    "Do customers describe your company consistently?": "Somewhat",
    "Can you quantify ROI for most customers?": "Somewhat",
    "Sales conversations primarily lead with:": "Business outcomes",
    "What financial metrics do customers see improve due to your product?": "Revenue growth",
    "How often are discounts required to close deals?": "Sometimes (10-40%)",
    "Do customers clearly understand your pricing tiers?": "Somewhat",
    "What is your gross margin (%)?": "75%+",
    "What are your primary acquisition channels (select up to 3)": ["Content", "Outbound SDR", "Partnerships"],
    "Do you know CAC by channel?": "Rough estimates",
    "How would you rate your growth status?": "Plateauing",
    "Marketing is measured primarily by:": "Pipeline",
    "Is attribution trusted internally?": "Debated",
    "Are revenue forecasts accurate within 10%": "No"
  }
};

const REQUIRED_FIELDS = [
  "tier",
  "overall_score",
  "band",
  "primary_constraint",
  "email_subject",
  "email_body_text",
  "email_body_html",
  "client_email",
  "exec_report_url",
  "hidden_report_url",
  "summary",
  "brand_to_gtm_os_score",
  "brand_to_gtm_os_band",
  "brand_to_gtm_os_primary_constraint",
  "brand_to_gtm_os_confidence"
];

async function runSmokeTest() {
  console.log(`Running smoke test against: ${url}`);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-vw-token": token
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`FAIL: Could not reach ${url} — ${err.message}`);
    process.exit(1);
  }

  if (res.status !== 200) {
    const body = await res.text();
    console.error(`FAIL: Expected HTTP 200 but got ${res.status}. Body: ${body}`);
    process.exit(1);
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`FAIL: Response is not valid JSON — ${err.message}`);
    process.exit(1);
  }

  // Check all required top-level fields exist
  const missing = REQUIRED_FIELDS.filter(field => !(field in data));
  if (missing.length > 0) {
    console.error(`FAIL: Response is missing required fields: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Check score is a number in valid range
  const score = data.overall_score;
  if (typeof score !== "number" || score < 0 || score > 100) {
    console.error(`FAIL: overall_score is invalid: ${score}`);
    process.exit(1);
  }

  // Check summary object has expected shape
  const summary = data.summary;
  if (!summary || typeof summary !== "object") {
    console.error("FAIL: summary is missing or not an object");
    process.exit(1);
  }
  if (!("score" in summary) || !("band" in summary) || !("confidence" in summary)) {
    console.error(`FAIL: summary is missing expected keys. Got: ${Object.keys(summary).join(", ")}`);
    process.exit(1);
  }

  // Check report object exists and has schema_version
  const report = data.report;
  if (!report || typeof report !== "object") {
    console.error("FAIL: report object is missing");
    process.exit(1);
  }
  if (!report.schema_version) {
    console.error("FAIL: report is missing schema_version");
    process.exit(1);
  }

  // Check report URLs are strings
  if (typeof data.exec_report_url !== "string" || !data.exec_report_url.includes("/api/report")) {
    console.error(`FAIL: exec_report_url looks invalid: ${data.exec_report_url}`);
    process.exit(1);
  }
  if (typeof data.hidden_report_url !== "string" || !data.hidden_report_url.includes("/api/report")) {
    console.error(`FAIL: hidden_report_url looks invalid: ${data.hidden_report_url}`);
    process.exit(1);
  }

  console.log("PASS: All smoke test assertions passed.");
  console.log(`  score=${data.overall_score}`);
  console.log(`  band=${data.band}`);
  console.log(`  primary_constraint=${data.primary_constraint}`);
  console.log(`  confidence=${data.brand_to_gtm_os_confidence}`);
  console.log(`  schema_version=${report.schema_version}`);
  console.log(`  exec_report_url=${data.exec_report_url}`);
  console.log(`  hidden_report_url=${data.hidden_report_url}`);
}

runSmokeTest();