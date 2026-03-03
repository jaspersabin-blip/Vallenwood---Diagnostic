export default async function handler(req, res) {
  const L = createDiagLogger(req);
  L.start();

  try {
    if (req.method !== "POST") {
      L.finish(405);
      return res.status(405).json({ error: "POST only" });
    }

    const token = req.headers["x-vw-token"];
    if (!token || token !== process.env.VW_TOKEN) {
      L.finish(401);
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = req.body || {};
    const answers = payload.answers;

    L.log("payload received", {
      tier: payload.tier,
      answers_keys:
        answers && typeof answers === "object" && !Array.isArray(answers)
          ? Object.keys(answers).length
          : null,
    });

    // ... your validation + tier normalization ...

    const tScore = L.mark();
    const config = getConfig();
    const scored = score(answers, config);
    L.step("score", tScore, { total: scored?.total, band: scored?.band });

    const tRender = L.mark();
    const content =
      tier === "audit"
        ? renderAudit({ scored, answers, clientName })
        : renderExecSummary({ scored, answers, clientName });
    L.step("render", tRender);

    const tBuild = L.mark();
    const report = buildReport({ tier, clientName, clientEmail, answers, scored, config, content });
    L.step("buildReport", tBuild);

    const llmEnabled = process.env.LLM_ENRICH === "1";
    L.log(`llm gate enabled=${llmEnabled} tier=${tier}`);

    if (llmEnabled && tier === "audit") {
      const tEnrich = L.mark();
      try {
        L.log("LLM enrichment START");
        const enriched = await enrichAuditReport(report);
        L.step("enrichAuditReport OK", tEnrich, {
          has_full_tier: !!enriched?.full_tier,
          has_narrative: !!enriched?.narrative,
        });

        if (enriched?.full_tier) report.full_tier = enriched.full_tier;
        if (enriched?.narrative) report.narrative = enriched.narrative;
        if (report?.disclaimer) report.disclaimer.ai_assisted = true;
      } catch (err) {
        L.step("enrichAuditReport FAIL", tEnrich, {
          message: err?.message,
          name: err?.name,
          status: err?.status,
          code: err?.code,
          type: err?.type,
        });

        // keep server alive + return deterministic output
        console.error("LLM enrichment failed (raw):", err);
        try {
          console.error(
            "LLM enrichment failed (stringified):",
            JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          );
        } catch (_) {}
      }
    }

    L.finish(200);
    return res.status(200).json({ /* your existing response */ });
  } catch (err) {
    L.error("Unhandled error", { message: err?.message, name: err?.name });
    L.finish(500);
    return res.status(500).json({ error: "Server error" });
  }
}