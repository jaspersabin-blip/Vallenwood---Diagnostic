import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function safeJsonParse(text) {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[enrichAudit] JSON parse failed:", err.message);
    console.error("[enrichAudit] Response length:", text?.length);
    console.error("[enrichAudit] Response tail:", text?.slice(-300));
    return {};
  }
}

function getCompactInput(data) {
  return {
    scoring: data.scoring,
    normalized_answers: data.inputs?.normalized_answers,
    website: data.client?.website || null,
  };
}

async function enrichAuditNarrative(data) {
  const model = process.env.LLM_MODEL || "gpt-4o";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant. Return ONLY valid JSON. No markdown. No commentary. No code fences. Use plain English. Anchor everything in commercial outcomes. Use value leakage as your core diagnostic concept — the gap between the value the company has built and what actually reaches buyers.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape:

{
  "swot": {
    "strengths": [
      {"point": "A specific commercial strength grounded in the inputs"},
      {"point": "A second distinct strength"},
      {"point": "A third distinct strength"}
    ],
    "weaknesses": [
      {"point": "A specific weakness creating value leakage — written as a commercial observation"},
      {"point": "A second distinct weakness"},
      {"point": "A third distinct weakness"}
    ],
    "opportunities": [
      {"point": "A specific opportunity to reduce leakage or improve commercial performance"},
      {"point": "A second distinct opportunity"},
      {"point": "A third distinct opportunity"}
    ],
    "threats": [
      {"point": "A specific commercial risk if the constraint is not addressed"},
      {"point": "A second distinct threat"},
      {"point": "A third distinct threat"}
    ]
  },
  "root_cause_hypotheses": [
    {
      "hypothesis": "Most likely root cause — a specific testable statement about why leakage is happening",
      "probability": "High",
      "what_it_looks_like": "Day-to-day symptoms a sales leader or CMO would recognize",
      "first_test": "The fastest way to validate or disprove this"
    },
    {
      "hypothesis": "Second most likely root cause",
      "probability": "Medium",
      "what_it_looks_like": "What this looks like in practice",
      "first_test": "How to test it quickly"
    },
    {
      "hypothesis": "Third possible root cause",
      "probability": "Lower",
      "what_it_looks_like": "What this looks like in practice",
      "first_test": "How to test it quickly"
    }
  ],
  "constraint_chain": [
    "How the primary constraint creates pressure on a second pillar — plain English chain reaction",
    "How that second-order effect creates a third problem, traced to a commercial outcome",
    "The end state if the constraint is not addressed in the next 12-18 months"
  ],
  "narrative": {
    "headline_diagnosis": "Two to three sentences naming the value leakage pattern in plain English. Start with what is working before naming what is breaking. Do not use framework labels — use commercial language.",
    "what_this_means_in_practice": [
      "A specific commercial symptom the reader is likely experiencing — written as an observation not a question",
      "A second symptom focused on something internal and operational",
      "A third symptom that shows up in competitive situations or pricing conversations",
      "A fourth symptom if warranted"
    ],
    "the_operating_tension": "The single most important contradiction from the diagnostic — the moment that makes the reader think how did they know that. Name it specifically, explain why it matters commercially, connect it to value leakage.",
    "what_good_looks_like": "A short description of what this company's revenue system looks like when the constraint is resolved. Written as aspiration not instruction. Make it feel achievable.",
    "upgrade_bridge": "Three to four specific questions the full audit answers that this summary cannot. Written as things the reader is already wondering — not a sales pitch."
  }
}

Rules:
- Each SWOT quadrant must have exactly 3 items. Each must be commercially specific — no generic observations.
- root_cause_hypotheses must have exactly 3 items.
- constraint_chain must have exactly 3 items.
- what_this_means_in_practice must have 3-4 items.
- Every point must be specific to these diagnostic inputs — not generic consulting language.
- Anchor everything in commercial outcomes: revenue, margin, win rate, deal velocity, pricing power.
- Revenue model may be SaaS, enterprise license, usage-based, or hybrid — calibrate accordingly.
- Write like a consultant presenting to a CEO who has heard every generic strategy pitch.
- Each SWOT item must be distinct — no repeating the same point in different words.

Diagnostic data:
${JSON.stringify(getCompactInput(data))}
`.trim();

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 3000,
  });

  const text = response.choices[0]?.message?.content || "{}";
  return safeJsonParse(text);
}

async function enrichAuditDetails(data) {
  const model = process.env.LLM_MODEL || "gpt-4o";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant. Return ONLY valid JSON. No markdown. No commentary. No code fences. Be commercially specific and direct. Every observation must connect to revenue, margin, win rate, or pricing power.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape:

{
  "competitive_context": {
    "category": "The competitive category in plain English",
    "most_compared_to": ["Competitor 1", "Competitor 2", "Competitor 3"],
    "competitive_frame": "How buyers are likely comparing this company to alternatives and whether that frame works in the company's favor",
    "positioning_hypotheses": [
      "A specific hypothesis about competitive positioning and commercial impact",
      "A second positioning hypothesis"
    ]
  },
  "pricing_insight": {
    "current_state_signals": [
      "A specific signal from the inputs about how pricing is functioning in the commercial motion",
      "A second signal about the relationship between value communication and price realization",
      "A third signal"
    ],
    "first_fixes": [
      "The highest-leverage pricing or packaging change — a specific action not a general recommendation",
      "A second specific fix",
      "A third specific fix"
    ],
    "what_to_validate": [
      "A specific question to answer before making pricing changes",
      "A second validation question",
      "A third validation question"
    ]
  },
  "roadmap": {
    "north_star": "One sentence describing the commercial outcome when the constraint is resolved",
    "thirty_day": [
      "The most important action in the first 30 days — fastest impact on reducing leakage",
      "A second 30-day action directly addressing the primary constraint",
      "A third 30-day action to test the root cause hypothesis"
    ],
    "sixty_day": [
      "A 60-day action building on what was learned in the first 30 days",
      "A second 60-day action focused on the commercial motion",
      "A third 60-day action focused on measurement — how to know if the fix is working"
    ],
    "ninety_day": [
      "A 90-day action to make the fix permanent — embedding it in process or hiring",
      "A second 90-day action focused on the next constraint in the chain",
      "A third 90-day action — what to stop doing that is no longer serving the commercial motion"
    ]
  },
  "constraint_analysis": {
    "mechanics": [
      "Plain English explanation of how the primary constraint creates value leakage",
      "How the constraint affects a different part of the revenue system",
      "The downstream effect on pricing power or competitive position"
    ],
    "growth_impact": [
      "What this constraint is likely costing in commercial performance — directional not invented numbers",
      "How the constraint affects the ability to compete at current ACV and sales cycle",
      "What improving this constraint would unlock in the revenue system"
    ]
  }
}

Rules:
- Each roadmap phase must have exactly 3 items.
- north_star must be a commercial outcome not a strategic aspiration.
- pricing_insight must be grounded in the specific inputs — not generic pricing advice.
- competitive_frame must explain how buyers actually compare this company to alternatives.
- Revenue model may be SaaS, enterprise license, usage-based, or hybrid — calibrate accordingly.
- Every point must be specific to these diagnostic inputs.

Diagnostic data:
${JSON.stringify(getCompactInput(data))}
`.trim();

  const response = await client.chat.completions.create({
    model,
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

export async function enrichAuditReport(data) {
  const [narrative, details] = await Promise.all([
    enrichAuditNarrative(data).catch(err => {
      console.error("[enrichAudit] narrative call failed:", err.message);
      return {};
    }),
    enrichAuditDetails(data).catch(err => {
      console.error("[enrichAudit] details call failed:", err.message);
      return {};
    }),
  ]);

  console.log("[enrichAudit] narrative keys:", Object.keys(narrative || {}));
  console.log("[enrichAudit] narrative.narrative keys:", Object.keys(narrative?.narrative || {}));
  console.log("[enrichAudit] details keys:", Object.keys(details || {}));

  const merged = { ...narrative, ...details };

  // Flatten narrative sub-fields to top level for easier mapping
  if (merged.narrative) {
    merged.headline_diagnosis = merged.narrative.headline_diagnosis || "";
    merged.what_this_means_in_practice = merged.narrative.what_this_means_in_practice || [];
    merged.the_operating_tension = merged.narrative.the_operating_tension || "";
    merged.what_good_looks_like = merged.narrative.what_good_looks_like || "";
    merged.upgrade_bridge = merged.narrative.upgrade_bridge || "";
  }

  return merged;
}

export async function enrichHiddenReport(data) {
  const model = process.env.LLM_MODEL || "gpt-4o";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant preparing an internal pre-call brief. Return ONLY valid JSON. No markdown. No commentary. No code fences. Write for a consultant not a client. Be direct, commercially sharp, and specific.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape:

{
  "constraint_hypothesis_summary": "Two to three sentences summarizing what is really going on in this company's revenue system and why. Written for a consultant who needs to walk in with a point of view.",
  "constraint_hypothesis": [
    "The most specific hypothesis about why value is leaking — a statement the consultant can test in the first 15 minutes",
    "A second hypothesis — a different angle on the same constraint",
    "A third hypothesis — the alternative if the first two are disproved"
  ],
  "commercial_friction": [
    "A specific friction point likely showing up in deals right now — something a sales leader would recognize immediately",
    "A second friction point at the handoff between marketing and sales or between value communication and pricing",
    "A third friction point that shows up in competitive situations"
  ],
  "likely_objections": [
    "The most likely objection the client will raise about the diagnosis and why they will raise it",
    "A second objection — often attributing the problem to execution rather than structure",
    "A third objection — about the cost or complexity of fixing it"
  ],
  "discovery_questions": [
    "The single most important question in the first 10 minutes — the one that confirms or disproves the primary hypothesis",
    "A question about where deals are slowing down — specific to their sales cycle and ACV",
    "A question about how pricing conversations currently happen — to test whether value is established before price enters",
    "A question about what their best reps do differently — to surface whether the constraint is structural or execution",
    "A question about measurement — to understand whether the company can see where leakage is happening"
  ],
  "conversation_strategy": [
    "How to open the call — what to establish in the first five minutes to build credibility and set the frame",
    "How to introduce the primary constraint — the specific language most likely to land without triggering defensiveness",
    "How to move from diagnosis to engagement — the natural bridge from here is what the model found to here is what we should do",
    "How to handle the most likely objection — specific language for the pushback to anticipate"
  ],
  "engagement_opportunities": [
    "The most natural first engagement — what problem is most ready to be solved right now",
    "A second engagement opportunity — what becomes possible once the primary constraint is addressed",
    "A third engagement opportunity — a longer-term work stream that would follow from the initial engagement"
  ],
  "consulting_opportunity": {
    "priority_engagement_angle": "The single most compelling frame for the first engagement — written as a value proposition not a service description",
    "upsell_readiness": "High, Medium, or Low — with a one sentence rationale",
    "likely_needs": [
      "The most specific consulting need based on the diagnostic",
      "A second specific need",
      "A third specific need"
    ]
  },
  "call_briefing": {
    "areas_to_validate_live": [
      "The most important thing to confirm in the conversation — a specific assumption the diagnostic made that needs live validation",
      "A second area to validate",
      "A third area to validate"
    ]
  }
}

Rules:
- Write for a consultant not a client
- Every point must be specific to this company — not generic
- Focus on what is most useful in the first 30 minutes of a client conversation
- Revenue model may be SaaS, enterprise license, usage-based, or hybrid

Diagnostic data:
${JSON.stringify(getCompactInput(data))}
`.trim();

  const response = await client.chat.completions.create({
    model,
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