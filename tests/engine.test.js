import test from "node:test";
import assert from "node:assert/strict";
import { buildExperimentPlan, scoreHypothesis } from "../src/engine/scoring.js";
import { buildEvidenceGraph } from "../src/graph/evidenceGraph.js";
import {
  associationEvidence,
  hypothesis,
  modelEvidence,
  perturbationEvidence
} from "./fixtures.js";

test("empty evidence produces TODO recommendations without provenance", () => {
  const plan = buildExperimentPlan(hypothesis, []);

  assert.equal(plan.hypothesis.confidence, 0);
  assert.deepEqual(plan.hypothesis.provenanceIds, []);
  assert.match(plan.hypothesis.todos[0], /Import gene-disease evidence/);
  assert.deepEqual(plan.models[0].provenanceIds, []);
});

test("hypothesis scoring includes provenance and confidence", () => {
  const result = scoreHypothesis(hypothesis, [associationEvidence]);

  assert.equal(result.provenanceIds[0], "EV-1");
  assert.equal(result.confidence, 0.8);
  assert.ok(result.score > 0.7);
});

test("planning ranks model systems and perturbations from relevant evidence", () => {
  const plan = buildExperimentPlan(hypothesis, [associationEvidence, modelEvidence, perturbationEvidence]);

  assert.equal(plan.models[0].title, "Patient-derived neurons");
  assert.deepEqual(plan.models[0].provenanceIds, ["EV-2"]);
  assert.equal(plan.perturbations[0].title, "CRISPRi knockdown");
  assert.deepEqual(plan.perturbations[0].provenanceIds, ["EV-3"]);
});

test("evidence graph links evidence records to typed entities", () => {
  const graph = buildEvidenceGraph([associationEvidence, modelEvidence]);

  assert.ok(graph.nodes.some((node) => node.id === "evidence:EV-1"));
  assert.ok(graph.nodes.some((node) => node.id === "gene:gene1"));
  assert.ok(graph.edges.every((edge) => edge.evidenceId));
});
