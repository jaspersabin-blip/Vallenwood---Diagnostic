// lib/enrichAudit.js
// Switched from OpenAI to Anthropic API — March 2026
// Fixes: empty slides 5-9, missing hidden report enrichment, silent error swallowing

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// safeJsonParse
// Strips any markdown code fences Claude might add despite instructions,
// then parses. Logs detail on failure so we can diagnose in Vercel runtime logs.
// ---------------------------------------------------------------------------
function safeJsonParse(text) {
  try {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[enrichAudit] JSON parse failed:", err.message);
    console.error("[enrichAudit] Response length:", text?.length);
    console.error("[enrichAudit] Response tail:", text?.slice(-500));
    return {};
  }
}

// ---------------------------------------------------------------------------
// getCompactInput
// Pulls only the fields the LLM actually needs — keeps token count down
// and focuses the model on what matters for diagnosis.
// ---------------------------------------------------------------------------
function getCompactInput(data) {
  const na = data.inputs?.normalized_answers || {};
  return {
    scoring: data.scoring,
    normalized_answers: na,
    website: data.client?.website || null,
    // Pass key inputs explicitly so the model mirrors them back in output
    key_inputs: {
      win_reason: na.win_reason,
      lose_reason: na.lose_reason,
      discounting: na.discounting,
      close_rate: na.close_rate,
      positioning_consistency: na.positioning_consistency,
      sales_lead: na.sales_lead,
      roi_repeatable: na.roi_repeatable,
      growth_status: na.growth_status,
      attribution_trusted: na.attribution_trusted,
      category: na.category,
      compared_to: na.compared_to,
      acv: na.acv,
      sales_cycle: na.sales_cycle,
      gross_margin: na.gross_margin,
    },
  };
}

// ---------------------------------------------------------------------------
// callClaude — shared wrapper for all Anthropic API calls
// Uses claude-sonnet-4-5 (set via LLM_MODEL env var)
// max_tokens set to 4096 to ensure full JSON output reaches all fields
// ---------------------------------------------------------------------------
async function callClaude({ systemPrompt, userPrompt }) {
  const model = process.env.LLM_MODEL || "claude-sonnet-4-5";

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0.4,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Anthropic returns content as an array of blocks — extract the text block
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  console.log("[enrichAudit] callClaude response length:", text.length);
  return safeJsonParse(text);
}

// ---------------------------------------------------------------------------
// enrichAuditNarrative
// Populates: swot, root_cause_hypotheses, constraint_chain, narrative fields
// These drive slides 4, 5, 6, 7 of the audit and hidden reports
// ---------------------------------------------------------------------------
async function enrichAuditNarrative(data) {
  const compactInput = getCompactInput(data);
  const primaryConstraint =
    data.scoring?.primary_constraint?.label ||
    data.scoring?.primary_constraint?.key ||
    "unknown";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant. " +
    "Return ONLY valid JSON. No markdown. No commentary. No code fences. " +
    "Use plain English accessible to both a first-time founder and a seasoned VP of Sales. " +
    "Anchor everything in commercial outcomes. " +
    "Use value leakage as your core diagnostic concept — the gap between the value " +
    "the company has built and what actually reaches buyers at the point of revenue generation. " +
    "CRITICAL: Mirror the specific input values back in your output. " +
    "Do not write generic consulting language — write observations that could only apply to this company.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape.
Every field is required. Do not skip any field or return null for any array.

Primary constraint identified by scoring: ${primaryConstraint}
Win reason from intake: ${compactInput.key_inputs.win_reason}
Lose reason from intake: ${compactInput.key_inputs.lose_reason}
Discount frequency from intake: ${compactInput.key_inputs.discounting}
Close rate from intake: ${compactInput.key_inputs.close_rate}
Positioning consistency from intake: ${compactInput.key_inputs.positioning_consistency}

{
  "swot": {
    "strengths": [
      {"point": "A specific commercial strength directly grounded in the intake inputs — reference the actual win reason or ROI signal"},
      {"point": "A second distinct strength from a different area of the diagnostic"},
      {"point": "A third distinct strength — must be different from the first two"}
    ],
    "weaknesses": [
      {"point": "The primary value leakage point — name the specific constraint and its commercial effect using the actual inputs"},
      {"point": "A second distinct weakness from a different pillar — reference a specific input signal"},
      {"point": "A third distinct weakness — must not repeat the first two"}
    ],
    "opportunities": [
      {"point": "The highest-leverage opportunity to reduce leakage — specific to this company's situation"},
      {"point": "A second distinct opportunity tied to a different part of the commercial motion"},
      {"point": "A third distinct opportunity — must be actionable not aspirational"}
    ],
    "threats": [
      {"point": "The most immediate competitive or commercial risk if the primary constraint is not addressed"},
      {"point": "A second distinct threat — from a different direction than the first"},
      {"point": "A third distinct threat — must reference a specific signal from the inputs"}
    ]
  },
  "root_cause_hypotheses": [
    {
      "hypothesis": "The single most likely root cause — a specific testable statement that references the actual inputs",
      "probability": "High",
      "what_it_looks_like": "Two or three specific day-to-day symptoms a sales leader or CMO at this company would immediately recognize",
      "first_test": "The fastest concrete action to validate or disprove this hypothesis"
    },
    {
      "hypothesis": "Second most likely root cause — a different angle, still grounded in the inputs",
      "probability": "Medium",
      "what_it_looks_like": "Specific symptoms that would show up differently than hypothesis one",
      "first_test": "How to test this one quickly and cheaply"
    },
    {
      "hypothesis": "Third possible root cause — the alternative explanation if the first two are disproved",
      "probability": "Lower",
      "what_it_looks_like": "What this looks like in practice — must be distinct from hypotheses one and two",
      "first_test": "How to test this hypothesis"
    }
  ],
  "constraint_chain": [
    "Plain English: how the primary constraint (${primaryConstraint}) creates direct pressure on a second pillar — name both pillars and the commercial mechanism",
    "How that second-order effect creates a third problem — trace it to a specific commercial outcome like win rate, deal velocity, or pricing power",
    "The compounding end state if this constraint is not addressed in the next 12-18 months — written as a realistic commercial scenario not a catastrophe"
  ],
  "narrative": {
    "headline_diagnosis": "Two to three sentences naming the value leakage pattern in plain English. Start with what IS working before naming what is breaking. Reference the specific win reason and lose reason from the inputs. Do not use framework labels — use commercial language a CEO would say out loud.",
    "what_this_means_in_practice": [
      "A specific commercial symptom this company is likely experiencing right now — written as an observation, reference the discount frequency or close rate signal",
      "A second symptom focused on something internal — the positioning consistency signal or attribution issue",
      "A third symptom that shows up in competitive situations — reference the lose reason and the competitor comparison",
      "A fourth symptom connecting the measurement gap to a business decision that is harder than it should be"
    ],
    "the_operating_tension": "The single most important contradiction from the diagnostic — the thing that makes the reader think how did they know that. Name the specific inputs that create the tension (e.g. wins on X but loses on Y, or clear pricing but high discounts). Explain why this tension matters commercially. Connect it to value leakage in plain English.",
    "what_good_looks_like": "A short description of what this company's revenue system looks like when the primary constraint is resolved. Written as an achievable aspiration — what becomes possible, what gets easier, what metrics improve. Do not write generic SaaS success language.",
    "upgrade_bridge": "Three to four specific questions the full audit answers that the exec summary cannot. Write them as things the reader is already wondering — not a sales pitch. Make them feel like the reader's own questions."
  }
}

Rules:
- Each SWOT quadrant must have exactly 3 items with real commercial specificity.
- root_cause_hypotheses must have exactly 3 items.
- constraint_chain must have exactly 3 items — each a complete sentence.
- what_this_means_in_practice must have exactly 4 items.
- Every point must reference something specific from the inputs — no generic SaaS consulting language.
- Write so a non-technical business owner and a VP Sales would both find this credible and specific.

Diagnostic data:
${JSON.stringify(compactInput)}
`.trim();

  return callClaude({ systemPrompt, userPrompt });
}

// ---------------------------------------------------------------------------
// enrichAuditDetails
// Populates: competitive_context, pricing_insight, roadmap, constraint_analysis
// These drive slides 8 and 9 of the audit report
// ---------------------------------------------------------------------------
async function enrichAuditDetails(data) {
  const compactInput = getCompactInput(data);
  const primaryConstraint =
    data.scoring?.primary_constraint?.label ||
    data.scoring?.primary_constraint?.key ||
    "unknown";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant. " +
    "Return ONLY valid JSON. No markdown. No commentary. No code fences. " +
    "Be commercially specific and direct. " +
    "Every observation must connect to revenue, margin, win rate, or pricing power. " +
    "CRITICAL: Mirror the specific input values in your output. " +
    "Reference the actual category, competitors, discount frequency, and sales cycle from the inputs.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape.
Every field is required. Do not skip any field or return null for any array.

Primary constraint: ${primaryConstraint}
Category from intake: ${compactInput.key_inputs.category}
Compared to from intake: ${compactInput.key_inputs.compared_to}
ACV from intake: ${compactInput.key_inputs.acv}
Sales cycle from intake: ${compactInput.key_inputs.sales_cycle}
Discount frequency: ${compactInput.key_inputs.discounting}
Gross margin: ${compactInput.key_inputs.gross_margin}

{
  "competitive_context": {
    "category": "The competitive category in plain English — based on the actual category input, not a generic label",
    "most_compared_to": ["Name from intake", "A likely second competitor based on category context", "A third likely competitor"],
    "competitive_frame": "How buyers are likely comparing this company to alternatives and whether that frame currently works in the company's favor — be specific about what the comparison favors and what it does not",
    "positioning_hypotheses": [
      "A specific hypothesis about what this company is likely signaling to buyers vs what it intends to signal — reference the win/lose reasons",
      "A second hypothesis about what would need to change in the competitive frame to improve win rates"
    ]
  },
  "pricing_insight": {
    "current_state_signals": [
      "A specific signal about how pricing is functioning — reference the actual discount frequency and pricing clarity inputs",
      "A signal about the relationship between value communication and price realization — reference the sales lead and ROI inputs",
      "A third signal about gross margin and what it suggests about pricing power in this category"
    ],
    "first_fixes": [
      "The single highest-leverage pricing or packaging change — a specific action, not a general recommendation. Reference the actual discount pattern.",
      "A second specific fix that addresses the gap between value communicated and price defended",
      "A third specific fix focused on packaging structure or tier clarity"
    ],
    "what_to_validate": [
      "The most important question to answer before making any pricing changes — specific to this company's situation",
      "A second validation question about whether the discount pattern is structural or a training issue",
      "A third validation question about how customers currently perceive the value-to-price relationship"
    ]
  },
  "roadmap": {
    "north_star": "One sentence — the commercial outcome when the primary constraint (${primaryConstraint}) is resolved. Write it as a measurable business result, not a strategic aspiration.",
    "thirty_day": [
      "The single most important action in the first 30 days — the fastest path to reducing the primary leakage point. Be specific.",
      "A second 30-day action directly addressing the primary constraint from a different angle",
      "A third 30-day action to test the most likely root cause hypothesis before investing further"
    ],
    "sixty_day": [
      "A 60-day action building on what was learned in the first 30 days — assumes the root cause is confirmed",
      "A second 60-day action focused on the commercial motion — sales process, messaging, or pricing guardrails",
      "A third 60-day action establishing how to measure whether the fix is working — a specific metric or signal"
    ],
    "ninety_day": [
      "A 90-day action to make the fix permanent — embed it in process, hiring, or tooling",
      "A second 90-day action focused on the next constraint in the chain identified in the diagnostic",
      "A third 90-day action — one thing to stop doing that is consuming resources without improving the commercial motion"
    ]
  },
  "constraint_analysis": {
    "mechanics": [
      "Plain English explanation of exactly how ${primaryConstraint} creates value leakage in this specific company",
      "How this constraint affects a different part of the revenue system — name the second-order effect",
      "The downstream effect on pricing power or competitive position — connect to the specific inputs"
    ],
    "growth_impact": [
      "What this constraint is likely costing in commercial performance — directional observation based on the close rate and discount inputs, not invented numbers",
      "How this constraint affects the ability to compete at the current ACV and sales cycle length",
      "What improving this constraint would unlock — a specific commercial improvement, not a generic benefit"
    ]
  }
}

Rules:
- Each roadmap phase must have exactly 3 items.
- north_star must name a commercial outcome not a strategic direction.
- pricing_insight must reference the actual discount frequency and pricing clarity inputs.
- competitive_frame must explain how buyers actually make the comparison today.
- Write so a non-technical founder and a VP Sales both find it credible and specific.

Diagnostic data:
${JSON.stringify(compactInput)}
`.trim();

  return callClaude({ systemPrompt, userPrompt });
}

// ---------------------------------------------------------------------------
// enrichAuditReport (exported — called from diagnostic.js for audit tier)
// Runs both enrichment calls in parallel, merges results,
// flattens narrative sub-fields to top level for HTML template mapping
// ---------------------------------------------------------------------------
export async function enrichAuditReport(data) {
  console.log("[enrichAudit] enrichAuditReport START");

  const [narrative, details] = await Promise.all([
    enrichAuditNarrative(data).catch((err) => {
      console.error("[enrichAudit] narrative call FAILED:", err.message, err.status);
      return {};
    }),
    enrichAuditDetails(data).catch((err) => {
      console.error("[enrichAudit] details call FAILED:", err.message, err.status);
      return {};
    }),
  ]);

  console.log("[enrichAudit] narrative keys:", Object.keys(narrative || {}));
  console.log("[enrichAudit] narrative.narrative keys:", Object.keys(narrative?.narrative || {}));
  console.log("[enrichAudit] details keys:", Object.keys(details || {}));

  const merged = { ...narrative, ...details };

  // Flatten narrative sub-fields to top level so diagnostic.js can read them directly
  if (merged.narrative) {
    merged.headline_diagnosis = merged.narrative.headline_diagnosis || "";
    merged.what_this_means_in_practice = merged.narrative.what_this_means_in_practice || [];
    merged.the_operating_tension = merged.narrative.the_operating_tension || "";
    merged.what_good_looks_like = merged.narrative.what_good_looks_like || "";
    merged.upgrade_bridge = merged.narrative.upgrade_bridge || "";
  }

  // Rename pricing_insight to match what buildAuditReportData expects
  if (merged.pricing_insight && !merged.pricing_packaging_audit) {
    merged.pricing_packaging_audit = merged.pricing_insight;
  }

  console.log("[enrichAudit] enrichAuditReport COMPLETE — merged keys:", Object.keys(merged));
  return merged;
}

// ---------------------------------------------------------------------------
// enrichHiddenReport (exported — called from diagnostic.js for hidden tier)
// THIS WAS NEVER BEING CALLED — it now gets invoked in diagnostic.js
// Populates the internal consulting layer: slides 11-13
// ---------------------------------------------------------------------------
export async function enrichHiddenReport(data) {
  console.log("[enrichAudit] enrichHiddenReport START");

  const compactInput = getCompactInput(data);
  const primaryConstraint =
    data.scoring?.primary_constraint?.label ||
    data.scoring?.primary_constraint?.key ||
    "unknown";

  const systemPrompt =
    "You are a senior B2B growth and go-to-market strategy consultant " +
    "preparing an internal pre-call brief for a colleague. " +
    "Return ONLY valid JSON. No markdown. No commentary. No code fences. " +
    "Write for a consultant who needs to walk into a client call with a sharp point of view. " +
    "Be direct, commercially specific, and assume the reader knows strategy. " +
    "CRITICAL: Every point must be specific to this company's inputs — not generic.";

  const userPrompt = `
Using the diagnostic data below, return ONLY valid JSON with this exact shape.
Every field is required. Do not skip any field or return null for any array.

Primary constraint: ${primaryConstraint}
Win reason: ${compactInput.key_inputs.win_reason}
Lose reason: ${compactInput.key_inputs.lose_reason}
Discount frequency: ${compactInput.key_inputs.discounting}
Close rate: ${compactInput.key_inputs.close_rate}
Positioning consistency: ${compactInput.key_inputs.positioning_consistency}
Sales lead with: ${compactInput.key_inputs.sales_lead}

{
  "constraint_hypothesis_summary": "Two to three sentences summarizing what is really going on in this company's revenue system. Written for a consultant who needs a sharp POV before the call. Reference the specific inputs — name the tension between win reason, lose reason, and the primary constraint.",
  "constraint_hypothesis": [
    "The most specific hypothesis about why value is leaking — a statement the consultant can test in the first 15 minutes. Reference the actual inputs.",
    "A second hypothesis from a different angle — still grounded in the inputs, not generic",
    "The alternative explanation if the first two are disproved — must be distinct"
  ],
  "commercial_friction": [
    "A specific friction point showing up in deals right now — reference the discount frequency and close rate",
    "A friction point at the boundary between value communication and pricing — reference the sales lead and ROI inputs",
    "A friction point that shows up specifically in competitive situations — reference the lose reason and competitor input"
  ],
  "likely_objections": [
    "The most likely objection the client will raise about the primary constraint diagnosis — and why they will raise it based on their inputs",
    "A second objection attributing the problem to execution or market conditions rather than structure",
    "A third objection about the cost, time, or complexity of addressing the constraint"
  ],
  "discovery_questions": [
    "The single most important question in the first 10 minutes — the one that confirms or disproves the primary hypothesis about ${primaryConstraint}",
    "A question about where deals slow down — specific to their actual ACV and sales cycle length",
    "A question about how pricing conversations happen — designed to reveal whether value is established before price enters the conversation",
    "A question about what their best reps do differently — to surface whether the constraint is structural or execution",
    "A question about measurement — to understand whether the company can actually see where leakage is occurring"
  ],
  "conversation_strategy": [
    "How to open the call — what to establish in the first five minutes to build credibility given what the diagnostic found. Reference the score and primary constraint specifically.",
    "How to introduce the primary constraint (${primaryConstraint}) — the specific language most likely to land without triggering defensiveness. Account for the likely objection.",
    "How to move from diagnosis to engagement — the natural bridge from the diagnostic findings to what the consultant offers. Keep it non-salesy.",
    "How to handle the most likely objection — specific language for the pushback, not generic objection handling advice"
  ],
  "engagement_opportunities": [
    "The most natural first engagement given the primary constraint and the company's situation right now",
    "A second engagement opportunity that becomes possible once the primary constraint is addressed",
    "A longer-term work stream that would follow logically from fixing the primary constraint"
  ],
  "consulting_opportunity": {
    "priority_engagement_angle": "The single most compelling frame for the first engagement — written as a value proposition the client will recognize as their own problem, not a service description",
    "upsell_readiness": "High — one specific sentence explaining why based on the diagnostic inputs",
    "likely_needs": [
      "The most specific consulting need based on the primary constraint and inputs",
      "A second specific need from a different part of the commercial system",
      "A third specific need that becomes visible once the first is addressed"
    ]
  },
  "call_briefing": {
    "areas_to_validate_live": [
      "The most important assumption the diagnostic made that needs live validation — be specific about what was assumed and why it might be wrong",
      "A second assumption to validate — about the competitive or pricing situation",
      "A third assumption to validate — about the internal alignment or measurement situation"
    ]
  }
}

Rules:
- Write for a consultant, not a client — assume strategic fluency
- Every point must be specific to this company's inputs — no generic observations
- Focus on what is most useful in the first 30 minutes of a client call
- The constraint_hypothesis_summary should feel like a sharp POV, not a summary

Diagnostic data:
${JSON.stringify(compactInput)}
`.trim();

  const result = await callClaude({ systemPrompt, userPrompt }).catch((err) => {
    console.error("[enrichAudit] enrichHiddenReport FAILED:", err.message, err.status);
    return {};
  });

  console.log("[enrichAudit] enrichHiddenReport COMPLETE — keys:", Object.keys(result || {}));
  return result;
}