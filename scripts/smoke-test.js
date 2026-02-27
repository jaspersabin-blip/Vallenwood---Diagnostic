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
  tier: "exec",
  answers: {
    "Why do you most often win deals?": "Clear differentiation",
    "Why do you most often lose deals?": "Price",
    "Do customers describe your company consistently?": "Often unclear",
    "Can you quantify ROI for most customers?": "Yes — documented & repeatable",
    "Sales conversations primarily lead with:": "Financial ROI",
    "How often are discounts required to close deals?": "Sometimes (10–40%)",
    "Do customers clearly understand your pricing tiers?": "Often confused",
    "What is your gross margin (%)?": "75%+",
    "Do you know CAC by channel?": "No",
    "How would you rate your growth status?": "Plateauing",
    "Marketing is measured primarily by:": "Revenue",
    "Is attribution trusted internally?": "No",
    "Are revenue forecasts accurate within 10%?": "No"
  }
};

const REQUIRED_FIELDS = [
  "report",
  "report_json",
  "tier",
  "overall_score",
  "band",
  "primary_constraint",
  "pillar_scores",
  "flags",
  "email_subject",
  "email_body_text",
  "client_email"
];

async function runSmokeTest() {
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

  for (const field of REQUIRED_FIELDS) {
    if (!(field in data)) {
      console.error(`FAIL: Response is missing required field: "${field}"`);
      process.exit(1);
    }
  }

  let parsedReport;
  try {
    parsedReport = JSON.parse(data.report_json);
  } catch (err) {
    console.error(`FAIL: report_json is not valid JSON — ${err.message}`);
    process.exit(1);
  }

  if (!parsedReport.schema_version) {
    console.error("FAIL: parsed report is missing schema_version");
    process.exit(1);
  }

  console.log("PASS: All smoke test assertions passed.");
  console.log(
    `  score=${data.overall_score}, band=${data.band}, schema_version=${parsedReport.schema_version}`
  );
}

runSmokeTest();
