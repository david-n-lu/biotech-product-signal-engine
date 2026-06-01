/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {ReturnType<import("../engine/scoring.js").buildExperimentPlan>} plan
 * @param {ReturnType<import("../reagents/recommender.js").recommendReagents>} reagents
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function exportPlanMarkdown(hypothesis, plan, reagents, evidence) {
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const lines = [
    "# Gene-Disease Experiment Plan",
    "",
    `Gene: ${hypothesis.gene || "TODO"}`,
    `Disease: ${hypothesis.disease || "TODO"}`,
    `Goal: ${hypothesis.goal || "TODO"}`,
    "",
    "## Hypothesis Priority",
    formatRecommendation(plan.hypothesis, evidenceById),
    "",
    "## Model Systems",
    ...plan.models.map((item) => formatRecommendation(item, evidenceById)),
    "",
    "## Perturbation Strategies",
    ...plan.perturbations.map((item) => formatRecommendation(item, evidenceById)),
    "",
    "## Reagents and Technologies",
    ...reagents.map((item) => formatRecommendation(item, evidenceById, true)),
    "",
    "## Evidence Provenance",
    ...evidence.map(formatEvidence)
  ];

  return lines.join("\n");
}

function formatRecommendation(item, evidenceById, includePurchase = false) {
  const lines = [
    `### ${item.title}`,
    `Confidence: ${formatPercent(item.confidence)}`,
    item.score === undefined ? "" : `Score: ${formatPercent(item.score)}`,
    `Rationale: ${item.rationale}`,
    `Provenance: ${item.provenanceIds.length ? item.provenanceIds.join(", ") : "TODO"}`
  ].filter(Boolean);

  if (includePurchase && item.purchase) {
    lines.push(`Purchase: ${[
      item.purchase.vendor,
      item.purchase.catalogNumber,
      item.purchase.url
    ].filter(Boolean).join(" | ")}`);
  }

  for (const todo of item.todos || []) {
    lines.push(`TODO: ${todo}`);
  }

  for (const id of item.provenanceIds || []) {
    const evidence = evidenceById.get(id);
    if (evidence) {
      lines.push(`- ${id}: ${evidence.source.title}`);
    }
  }

  return lines.join("\n");
}

function formatEvidence(record) {
  const locator = record.source.url || record.source.citation;
  return `- ${record.id}: ${record.source.title}; ${locator}; accessed ${record.source.accessedAt}; confidence ${formatPercent(record.confidence)}`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}
