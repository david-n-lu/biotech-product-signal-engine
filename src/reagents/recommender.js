import { findRelevantEvidence } from "../engine/scoring.js";

/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function recommendReagents(hypothesis, evidence) {
  const relevant = findRelevantEvidence(hypothesis, evidence).filter((record) => {
    return record.evidenceType === "reagent" && record.entities.reagent;
  });

  if (relevant.length === 0) {
    return [{
      id: "todo:reagents",
      title: "Reagent list needs evidence",
      rationale: "No imported evidence names a purchasable or buildable reagent for this gene-disease pair.",
      confidence: 0,
      score: 0,
      provenanceIds: [],
      todos: ["Import reagent evidence with vendor, catalog, sequence, or protocol provenance before purchasing."]
    }];
  }

  return relevant
    .map((record) => ({
      id: `reagent:${record.id}`,
      title: record.entities.reagent,
      rationale: record.claim,
      confidence: record.confidence,
      score: record.confidence,
      provenanceIds: [record.id],
      purchase: record.purchase,
      technology: record.entities.technology,
      todos: record.purchase
        ? []
        : ["Add vendor/catalog/protocol details before purchase or build handoff."]
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
