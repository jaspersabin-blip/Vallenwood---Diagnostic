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
  const userPrompt = `
You are writing a Brand-to-GTM OS Strategic Audit for a mid-market B2B technology company. Your job is to think like a senior strategy consultant who has reviewed hundreds of companies — direct, specific, and commercially grounded. Every sentence should earn its place.

VOICE AND LANGUAGE RULES — follow these strictly:
- Write in plain English. No MBA jargon, no generic consulting language.
- Use "value leakage" as the core diagnostic concept — the gap between the value the company has built and the value that reaches buyers.
- Never use these words or phrases: "leverage", "synergies", "holistic", "robust", "optimize", "utilize", "it is important to note", "in conclusion", "moving forward", "deep dive".
- Write like a consultant pointing at a whiteboard — specific, direct, occasionally blunt.
- Every observation must connect to a commercial outcome: revenue, margin, deal velocity, win rate, or pricing power.
- If data is limited, use hypothesis language: "this suggests", "likely", "the pattern here typically indicates".
- Do not invent specific numbers or benchmarks.

THE CORE FRAMEWORK — understand this before writing:
The Brand-to-GTM OS measures how well a company's value story — built through positioning, pricing, and go-to-market execution — actually reaches buyers and converts. When the system is aligned, value flows cleanly from brand to close. When it isn't, value leaks — usually at the handoff between brand strength and commercial execution. The score reflects how much leakage exists and where.

Using the diagnostic data below, return ONLY valid JSON with this exact shape:

{
  "swot": {
    "strengths": [
      {"point": "A specific commercial strength grounded in the diagnostic inputs — what is working in the revenue system and why it matters"},
      {"point": "A second specific strength"},
      {"point": "A third specific strength"}
    ],
    "weaknesses": [
      {"point": "A specific weakness that is creating value leakage — written as a commercial observation, not a framework label"},
      {"point": "A second specific weakness"},
      {"point": "A third specific weakness"}
    ],
    "opportunities": [
      {"point": "A specific opportunity to reduce leakage or improve commercial performance — what becomes possible if the constraint is addressed"},
      {"point": "A second specific opportunity"},
      {"point": "A third specific opportunity"}
    ],
    "threats": [
      {"point": "A specific commercial risk if the constraint is not addressed — written in terms of competitive position, pricing power, or revenue performance"},
      {"point": "A second specific threat"},
      {"point": "A third specific threat"}
    ]
  },
  "constraint_analysis": {
    "mechanics": [
      "Plain English explanation of how the primary constraint creates value leakage — trace the chain from root cause to commercial symptom",
      "A second mechanic — how the constraint affects a different part of the revenue system",
      "A third mechanic — the downstream effect on pricing power or competitive position"
    ],
    "growth_impact": [
      "What this constraint is likely costing the company in commercial performance terms — use directional language not invented numbers",
      "How the constraint affects the company's ability to compete at current ACV and sales cycle",
      "What improving this constraint would unlock in the revenue system"
    ]
  },
  "root_cause_hypotheses": [
    {
      "hypothesis": "Most likely root cause — written as a specific, testable statement about why the leakage is happening",
      "probability": "High",
      "what_it_looks_like": "What this looks like in practice — the day-to-day symptoms a sales leader or CMO would recognize",
      "first_test": "The fastest way to validate or disprove this hypothesis"
    },
    {
      "hypothesis": "Second most likely root cause",
      "probability": "Medium",
      "what_it_looks_like": "What this looks like in practice",
      "first_test": "The fastest way to validate or disprove this hypothesis"
    },
    {
      "hypothesis": "Third possible root cause",
      "probability": "Lower",
      "what_it_looks_like": "What this looks like in practice",
      "first_test": "The fastest way to validate or disprove this hypothesis"
    }
  ],
  "constraint_chain": [
    "How the primary constraint creates pressure on a second pillar — written as a chain reaction in plain English",
    "How that second-order effect creates a third problem — trace it through to a commercial outcome",
    "The end state if the constraint is not addressed — what the revenue system looks like in 12-18 months"
  ],
  "pricing_insight": {
    "current_state_signals": [
      "A specific signal from the inputs about how pricing is functioning in the commercial motion",
      "A second signal — focus on the relationship between value communication and price realization",
      "A third signal"
    ],
    "first_fixes": [
      "The highest-leverage pricing or packaging change — written as a specific action, not a recommendation to 'review pricing'",
      "A second specific fix",
      "A third specific fix"
    ],
    "what_to_validate": [
      "A specific question to answer before making pricing changes",
      "A second validation question",
      "A third validation question"
    ]
  },
  "competitive_context": {
    "category": "The competitive category in plain English",
    "most_compared_to": ["Competitor 1", "Competitor 2", "Competitor 3"],
    "competitive_frame": "How buyers are likely comparing this company to alternatives — what frame the competition is being evaluated in and whether that frame works in the company's favor",
    "positioning_hypotheses": [
      "A specific hypothesis about where the company sits in the competitive frame and how that affects commercial performance",
      "A second positioning hypothesis"
    ]
  },
  "roadmap": {
    "north_star": "One sentence describing what the revenue system looks like when the constraint is resolved — written as a commercial outcome, not a strategic aspiration",
    "thirty_day": [
      "The single most important action in the first 30 days — the move that will have the fastest impact on reducing leakage",
      "A second 30-day action that directly addresses the primary constraint",
      "A third 30-day action — something that can be done quickly to test the root cause hypothesis"
    ],
    "sixty_day": [
      "A 60-day action that builds on what was learned in the first 30 days",
      "A second 60-day action focused on the commercial motion — how deals are run or how value is established",
      "A third 60-day action focused on measurement — how to know if the fix is working"
    ],
    "ninety_day": [
      "A 90-day action focused on making the fix permanent — embedding it in process, hiring, or tooling",
      "A second 90-day action focused on the next constraint in the chain",
      "A third 90-day action — what to stop doing that is no longer serving the commercial motion"
    ]
  },
  "narrative": {
    "headline_diagnosis": "Two to three sentences that name the value leakage pattern in plain English — the opening of the report that makes the reader feel seen. Start with what is working before naming what is breaking.",
    "what_this_means_in_practice": [
      "A specific commercial symptom the reader is likely experiencing — written as an observation, not a question",
      "A second symptom — focus on something that feels internal and operational, not just top-line",
      "A third symptom — something that shows up in competitive situations or pricing conversations",
      "A fourth symptom if warranted by the data"
    ],
    "the_operating_tension": "The single most important contradiction surfaced by the diagnostic — the 'how did they know that?' moment. Name it specifically, explain why it matters commercially, and connect it to the value leakage pattern.",
    "what_good_looks_like": "A short description of what the revenue system looks like when this constraint is resolved — what a company at this stage with this profile looks like when it's working. Written as aspiration, not instruction.",
    "upgrade_bridge": "Three to four specific questions the full audit answers that the exec summary cannot — written as things the reader is already wondering, not as a sales pitch. Make them feel like the natural next questions a thoughtful executive would ask after reading this summary."
  }
}

Rules:
- Every point must be specific to the diagnostic inputs — no generic consulting observations
- Anchor everything in commercial outcomes: revenue, margin, win rate, deal velocity, pricing power
- Use the value leakage framing throughout — this is the core concept
- Revenue model may be SaaS, enterprise license, usage-based, or hybrid — calibrate language accordingly
- If the company website is provided, use it to inform competitive context and positioning language
- Write like you are presenting to a CEO or CMO who has heard every generic strategy pitch — they will dismiss anything that sounds templated

Diagnostic data:
${JSON.stringify(data)}

Company website (use for additional context if available):
${data.website || data.client?.website || "Not provided"}
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