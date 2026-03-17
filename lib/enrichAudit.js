import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeJsonParse(text) {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

export async function enrichAuditReport(data) {
  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant. Return ONLY valid JSON. No markdown. No commentary. No code fences.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this shape:

{
  "swot": {
    "strengths": [{"point": ""}, {"point": ""}, {"point": ""}],
    "weaknesses": [{"point": ""}, {"point": ""}, {"point": ""}],
    "opportunities": [{"point": ""}, {"point": ""}, {"point": ""}],
    "threats": [{"point": ""}, {"point": ""}, {"point": ""}]
  },
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
    "sixty_day": [],
    "ninety_day": []
  }
}

Rules:
- concise bullet points
- focus on revenue impact
- avoid generic consulting language
- if information is missing, make cautious hypotheses
- do not invent precise facts or fake benchmarks
- write like a strategy consultant speaking to a B2B executive
- revenue model may be SaaS, enterprise license, usage-based, or hybrid — calibrate accordingly
- each SWOT quadrant must contain exactly 3 specific, evidence-based points drawn from the diagnostic data
- avoid generic statements — every point should reference a specific signal from the inputs (e.g. pricing pressure, feature-led selling, CAC visibility)
- each roadmap phase must contain exactly 3 specific action items, not generic principles

Diagnostic data:
${JSON.stringify(data)}
`.trim();

  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 2000,
  });

  const text = response.choices[0]?.message?.content || "{}";
  return safeJsonParse(text);
}

export async function enrichHiddenReport(data) {
  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant preparing an internal pre-call brief. Return ONLY valid JSON. No markdown. No commentary. No code fences.";

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
- revenue model may be SaaS, enterprise license, usage-based, or hybrid — calibrate accordingly

Diagnostic data:
${JSON.stringify(data)}
`.trim();

  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 2000,
  });

  const text = response.choices[0]?.message?.content || "{}";
  return safeJsonParse(text);
}