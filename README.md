# Brand-to-GTM OS Diagnostic

This repository contains:

- Scoring logic for the diagnostic
- AI prompt templates
- Output templates (Exec Summary + Full Diagnostic)
- Sample submissions for testing

## Architecture

Form → Zapier → Score → AI Generation → Google Doc → PDF → Email

## Segmentation Bands

0–6: Foundational
7–12: Scaling
13+: High-Leverage Alignment

## Environment Variables

| Variable         | Required | Description                                                   |
|------------------|----------|---------------------------------------------------------------|
| `VW_TOKEN`       | Yes      | Secret token used to authenticate requests to the diagnostic endpoint (`x-vw-token` header). |
| `DIAGNOSTIC_URL` | No       | Override the endpoint URL for smoke tests (default: `http://localhost:3000/api/diagnostic`). |

Example `.env` (never commit this file):

```
VW_TOKEN=your_secret_token
DIAGNOSTIC_URL=http://localhost:3000/api/diagnostic
```

## Running the Smoke Test

Requires Node.js 18+.

```bash
npm install
VW_TOKEN=your_secret_token npm run smoke:test
```

The smoke test will POST a sample payload to the diagnostic endpoint and assert that the response contains all required fields and a valid structured report.

