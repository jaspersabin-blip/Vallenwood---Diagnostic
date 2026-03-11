import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function enrichAuditReport(data) {
  const systemPrompt =
    "You are a senior B2B SaaS strategy consultant. Return ONLY valid JSON. No markdown. No commentary.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this shape:

{
  "swot": {
    "strengths": [{"point": ""}],
    "weaknesses": [{"point": ""}],
    "opportunities": [{"point": ""}],
    "threats": [{"point": ""}]
  },
  "constraint_analysis": {
    "mechanics": [],
    "growth_impact": []
  },
  "pricing_insight": {
    "current_state_signals": [],
    "first_fixes": [],
    "what_to_validate": []
  },
  "competitive_context": {
    "category": "",
    "most_compared_to": []
  },
  "roadmap": {
    "thirty_day": [],
    "ninety_day": [],
    "six_to_twelve_month": []
  }
}

Rules:
- concise bullet points
- focus on revenue impact
- avoid generic consulting language
- if information is missing, make cautious hypotheses
- do not invent precise facts or fake benchmarks
- write like a strategy consultant speaking to a B2B executive

Diagnostic data:
${JSON.stringify(data)}
`.trim();

  const response = await client.responses.create({
    model: process.env.LLM_MODEL || "gpt-5",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.output_text || "{}";
  return safeJsonParse(text);
}

export async function enrichHiddenReport(data) {
  const systemPrompt =
    "You are a senior B2B SaaS strategy consultant preparing an internal pre-call brief. Return ONLY valid JSON. No markdown. No commentary.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this shape:

{
  "constraint_hypothesis_summary": "",
  "constraint_hypothesis": [],
  "commercial_friction": [],
  "likely_objections": [],
  "discovery_questions": [],
  "conversation_strategy": [],
  "engagement_opportunities": [],
  "consulting_opportunity": {
    "priority_engagement_angle": "",
    "upsell_readiness": "",
    "likely_needs": []
  },
  "call_briefing": {
    "areas_to_validate_live": []
  }
}

Rules:
- write for internal use by a consultant preparing for a review call
- be concise, specific, and commercially sharp
- focus on likely dynamics, objections, and next best consulting angle
- do not invent precise facts
- if data is limited, use cautious hypothesis language

Diagnostic data:
${JSON.stringify(data)}
`.trim();

  const response = await client.responses.create({
    model: process.env.LLM_MODEL || "gpt-5",
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.output_text || "{}";
  return safeJsonParse(text);
}