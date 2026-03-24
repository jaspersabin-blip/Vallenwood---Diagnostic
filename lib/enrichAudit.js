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
    "You are a senior revenue strategy advisor writing a diagnostic report that goes directly to the client. " +
    "Return ONLY valid JSON. No markdown. No commentary. No code fences. " +
    "VOICE: Write in second person — use 'you' and 'your team' not 'the company' or 'they'. " +
    "Write the way a trusted advisor speaks directly to a smart business owner. " +
    "Avoid jargon: say 'where you lose deals' not 'value leakage', say 'what drives revenue' not 'commercial motion', " +
    "say 'your sales team' not 'reps', say 'why customers choose you' not 'win reason'. " +
    "Be direct and specific. Every observation must name a real behavior or consequence from the inputs. " +
    "Never write something that could apply to any company. Write only what is true about this one. " +
    "CRITICAL: Mirror the specific input values back in your output — close rate, discount frequency, competitors, win/lose reasons. " +
    "TONE: When describing what the data suggests about the business — its gaps, behaviors, or patterns — use exploratory language. " +
    "Say 'this often suggests', 'this pattern may indicate', 'if this is the case', 'one possibility is', 'worth exploring whether'. " +
    "You are surfacing indicators and hypotheses worth investigating, not pronouncing hard facts about the business. " +
    "A 20-question intake cannot tell the whole story — write with the humility of an advisor who has seen the data but not yet sat in the room. " +
    "Reserve direct, confident language for recommendations and next steps only — those should still be clear and actionable.";

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
    "COMPLETE SENTENCE, MAX 40 WORDS: How ${primaryConstraint} creates direct pressure on a second pillar — name both pillars and the commercial mechanism. Must end with a period.",
    "COMPLETE SENTENCE, MAX 40 WORDS: How that second-order effect creates a third problem — trace to a specific commercial outcome like win rate or pricing power. Must end with a period.",
    "COMPLETE SENTENCE, MAX 40 WORDS: The realistic commercial end state if this constraint is not addressed in 12-18 months. Must end with a period."
  ],
  "narrative": {
    "headline_diagnosis": "Write exactly one sentence using this structure: '[Company] wins on [win_reason] but loses on [lose_reason] because [primary_constraint] prevents the value from converting at the point of sale.' Fill in the bracketed parts with the actual input values. One sentence only. Maximum 25 words. End with a period.",
    "what_this_means_in_practice": [
      "One complete sentence, max 22 words. Name a specific sales behavior and its commercial consequence using actual inputs. Example: 'Reps discount 10-40% of deals because the ROI case arrives after price, not before it.'",
      "One complete sentence, max 22 words. Name a specific marketing or attribution behavior and its consequence using actual inputs. Example: 'Marketing cannot identify which channel produces the 40%+ close rate because attribution stops at lead not deal.'",
      "One complete sentence, max 22 words. Name a specific competitive situation and outcome. Must reference the named competitor and lose reason. Example: 'Deals lost to Salesforce on price happen after feature comparison, not value comparison.'",
      "One complete sentence, max 22 words. Name a specific leadership decision that is harder because of the primary constraint. Example: 'Budget allocation relies on gut feel because no channel data connects spend to closed revenue.'"
    ],
    "the_operating_tension": "MAX 60 WORDS. The single most important contradiction from the diagnostic. Name the specific inputs that create the tension (e.g. wins on X but loses on Y). Explain why this tension matters commercially in one sentence. Must be a complete thought that ends with a period.",
    "what_good_looks_like": "MAX 50 WORDS. Two to three sentences describing what becomes measurably easier when the primary constraint is resolved. Name specific metrics or behaviors that improve. No generic SaaS success language. Must end with a period.",
    "upgrade_bridge": "Three to four specific questions the full audit answers that the exec summary cannot. Write them as things the reader is already wondering — not a sales pitch. Make them feel like the reader's own questions."
  }
}

Rules:
- Write in second person throughout — "you win on X" not "the company wins on X".
- Use plain language — avoid GTM jargon, framework labels, and insider terms.
- Use conditional/exploratory language for observations and diagnoses — "this may suggest", "this pattern often indicates", "worth exploring whether". Reserve direct language for recommendations only.
- Each SWOT quadrant must have exactly 3 items with real commercial specificity.
- root_cause_hypotheses must have exactly 3 items.
- constraint_chain must have exactly 3 items — each a complete sentence.
- what_this_means_in_practice must have exactly 4 items.
- Every point must reference something specific from the inputs — no generic consulting language.
- Write so a first-time founder and a seasoned sales leader would both find this credible, clear, and specific.

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
    "You are a senior revenue strategy advisor writing a diagnostic report that goes directly to the client. " +
    "Return ONLY valid JSON. No markdown. No commentary. No code fences. " +
    "VOICE: Write in second person — use 'you' and 'your team' not 'the company' or 'they'. " +
    "Write the way a trusted advisor speaks to a smart business owner — clear, direct, no jargon. " +
    "Avoid insider language: say 'how you win deals' not 'win motion', say 'your pricing' not 'packaging architecture', " +
    "say 'what your buyers compare you against' not 'competitive frame'. " +
    "Every observation must connect to a real business outcome: revenue, win rate, deal size, or margin. " +
    "CRITICAL: Mirror the actual inputs — reference the category, competitors, discount frequency, and sales cycle. " +
    "TONE: When describing what the data suggests about the business — its gaps, patterns, or behaviors — use exploratory language. " +
    "Say 'this often suggests', 'this pattern may indicate', 'one possibility is', 'worth exploring whether'. " +
    "You are surfacing indicators worth investigating, not declaring facts. " +
    "Reserve direct, confident language for recommendations and first fixes only — those should be clear and actionable.";

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
      "COMPLETE SENTENCE, MAX 35 WORDS: A specific pricing signal referencing the actual discount frequency. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A signal about value communication vs price realization — reference the sales lead and ROI inputs. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: What the gross margin signals about pricing power in this category. Must end with a period."
    ],
    "first_fixes": [
      "COMPLETE SENTENCE, MAX 35 WORDS: The highest-leverage pricing or packaging change — a specific action referencing the actual discount pattern. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A second specific fix addressing the gap between value communicated and price defended. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A third specific fix focused on packaging structure or tier clarity. Must end with a period."
    ],
    "what_to_validate": [
      "The most important question to answer before making any pricing changes — specific to this company's situation",
      "A second validation question about whether the discount pattern is structural or a training issue",
      "A third validation question about how customers currently perceive the value-to-price relationship"
    ]
  },
  "roadmap": {
    "north_star": "One complete sentence — the measurable commercial outcome when ${primaryConstraint} is resolved. Maximum 30 words. No strategic aspirations — name a specific business result.",
    "thirty_day": [
      "COMPLETE SENTENCE, MAX 35 WORDS: The single most important 30-day action — name the specific action, the mechanism, and the expected outcome. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A second 30-day action from a different angle — specific to the primary constraint. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A third 30-day action to test the most likely root cause before investing further. Must end with a period."
    ],
    "sixty_day": [
      "COMPLETE SENTENCE, MAX 35 WORDS: A 60-day action building on 30-day learnings — assumes root cause is confirmed. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A second 60-day action focused on the commercial motion — sales process, messaging, or pricing. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A third 60-day action establishing a specific metric or signal to measure whether the fix is working. Must end with a period."
    ],
    "ninety_day": [
      "COMPLETE SENTENCE, MAX 35 WORDS: A 90-day action to make the fix permanent — embed in process, hiring, or tooling. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: A second 90-day action focused on the next constraint in the chain. Must end with a period.",
      "COMPLETE SENTENCE, MAX 35 WORDS: One specific thing to stop doing that consumes resources without improving the commercial motion. Must end with a period."
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
- Write in second person throughout — "your pricing" not "the pricing", "your buyers" not "buyers".
- Use plain language — no GTM jargon or framework terms.
- Use conditional/exploratory language for observations — "this may suggest", "this pattern often indicates", "one possibility is". Reserve direct language for recommendations and first fixes only.
- Each roadmap phase must have exactly 3 items.
- north_star must name a measurable commercial outcome.
- pricing_insight must reference the actual discount frequency and pricing clarity inputs.
- competitive_frame must explain how your buyers actually compare you to alternatives today.
- Write so a first-time founder and a seasoned sales leader both find it credible, direct, and specific.

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
  "constraint_hypothesis_summary": "MAX 60 WORDS. Two to three complete sentences summarizing what is really going on. Written for a consultant who needs a sharp POV. Reference the specific inputs — name the tension between win reason, lose reason, and primary constraint. Must end with a period.",
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