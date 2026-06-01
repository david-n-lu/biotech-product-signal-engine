const SUPPORT_WEIGHTS = {
  supports: 1,
  mixed: 0.45,
  context: 0.25,
  contradicts: -0.9
};

const TYPE_WEIGHTS = {
  genetic_association: 1,
  functional: 0.95,
  model_system: 0.8,
  perturbation: 0.75,
  reagent: 0.55,
  technology: 0.45,
  safety: 0.35,
  other: 0.25
};

/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function scoreHypothesis(hypothesis, evidence) {
  const relevant = findRelevantEvidence(hypothesis, evidence);
  if (relevant.length === 0) {
    return {
      id: "hypothesis:no-evidence",
      title: formatHypothesisTitle(hypothesis),
      rationale: "No imported evidence matches both the gene and disease yet.",
      confidence: 0,
      score: 0,
      provenanceIds: [],
      todos: ["Import gene-disease evidence with provenance and confidence before prioritizing."]
    };
  }

  const weighted = relevant.reduce((sum, record) => {
    return sum + record.confidence * SUPPORT_WEIGHTS[record.supports] * TYPE_WEIGHTS[record.evidenceType];
  }, 0);
  const maxPossible = relevant.reduce((sum, record) => {
    return sum + Math.max(TYPE_WEIGHTS[record.evidenceType], 0.25);
  }, 0);
  const score = clamp01(maxPossible === 0 ? 0 : weighted / maxPossible);
  const confidence = mean(relevant.map((record) => record.confidence));

  return {
    id: `hypothesis:${hypothesis.gene}:${hypothesis.disease}`,
    title: formatHypothesisTitle(hypothesis),
    rationale: `${relevant.length} evidence record${relevant.length === 1 ? "" : "s"} matched the gene-disease pair.`,
    confidence,
    score,
    provenanceIds: relevant.map((record) => record.id),
    todos: relevant.some((record) => record.supports === "contradicts")
      ? ["Review contradictory evidence before committing resources."]
      : []
  };
}

/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function recommendModelSystems(hypothesis, evidence) {
  const relevant = findRelevantEvidence(hypothesis, evidence).filter((record) => record.entities.modelSystem);
  if (relevant.length === 0) {
    return [todoRecommendation(
      "model-system",
      "Model system needs evidence",
      "No imported evidence names a model system for this gene-disease pair.",
      "Import model-system evidence before selecting an organism, cell line, organoid, or in vivo model."
    )];
  }

  return rankByEntity(relevant, "modelSystem").map((group) => ({
    id: `model:${group.name}`,
    title: group.name,
    rationale: `${group.records.length} evidence record${group.records.length === 1 ? "" : "s"} support considering this model system.`,
    confidence: group.confidence,
    score: group.score,
    provenanceIds: group.records.map((record) => record.id),
    todos: group.records.some((record) => record.evidenceType !== "model_system")
      ? ["Confirm disease-relevant phenotype and assay readout for this model."]
      : []
  }));
}

/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function recommendPerturbations(hypothesis, evidence) {
  const relevant = findRelevantEvidence(hypothesis, evidence).filter((record) => record.entities.perturbation);
  if (relevant.length === 0) {
    return [todoRecommendation(
      "perturbation",
      "Perturbation strategy needs evidence",
      "No imported evidence names a perturbation strategy for this gene-disease pair.",
      "Import perturbation evidence before choosing CRISPR, RNAi, overexpression, rescue, or pharmacology."
    )];
  }

  return rankByEntity(relevant, "perturbation").map((group) => ({
    id: `perturbation:${group.name}`,
    title: group.name,
    rationale: `${group.records.length} evidence record${group.records.length === 1 ? "" : "s"} support considering this perturbation.`,
    confidence: group.confidence,
    score: group.score,
    provenanceIds: group.records.map((record) => record.id),
    todos: ["Confirm construct design, controls, delivery route, and assay timing."]
  }));
}

/**
 * @param {import("../domain/types.js").Hypothesis} hypothesis
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function buildExperimentPlan(hypothesis, evidence) {
  return {
    hypothesis: scoreHypothesis(hypothesis, evidence),
    models: recommendModelSystems(hypothesis, evidence),
    perturbations: recommendPerturbations(hypothesis, evidence)
  };
}

export function findRelevantEvidence(hypothesis, evidence) {
  const gene = normalize(hypothesis.gene);
  const disease = normalize(hypothesis.disease);
  return evidence.filter((record) => {
    const recordGene = normalize(record.entities.gene);
    const recordDisease = normalize(record.entities.disease);
    return recordGene === gene && recordDisease === disease;
  });
}

function rankByEntity(records, key) {
  const groups = new Map();
  for (const record of records) {
    const name = record.entities[key];
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(record);
  }

  return [...groups.entries()]
    .map(([name, groupRecords]) => {
      const score = clamp01(groupRecords.reduce((sum, record) => {
        return sum + record.confidence * SUPPORT_WEIGHTS[record.supports] * TYPE_WEIGHTS[record.evidenceType];
      }, 0) / groupRecords.length);
      return {
        name,
        records: groupRecords,
        score,
        confidence: mean(groupRecords.map((record) => record.confidence))
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function todoRecommendation(id, title, rationale, todo) {
  return {
    id: `todo:${id}`,
    title,
    rationale,
    confidence: 0,
    score: 0,
    provenanceIds: [],
    todos: [todo]
  };
}

function formatHypothesisTitle(hypothesis) {
  const gene = hypothesis.gene || "Unspecified gene";
  const disease = hypothesis.disease || "unspecified disease";
  return `${gene} in ${disease}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
