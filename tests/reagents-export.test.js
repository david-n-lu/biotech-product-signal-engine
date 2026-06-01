import test from "node:test";
import assert from "node:assert/strict";
import { buildExperimentPlan } from "../src/engine/scoring.js";
import { exportPlanMarkdown } from "../src/export/markdown.js";
import { recommendReagents } from "../src/reagents/recommender.js";
import {
  associationEvidence,
  hypothesis,
  modelEvidence,
  reagentEvidence
} from "./fixtures.js";

test("reagent recommender returns TODO when no reagent evidence exists", () => {
  const recommendations = recommendReagents(hypothesis, [associationEvidence]);

  assert.equal(recommendations[0].confidence, 0);
  assert.deepEqual(recommendations[0].provenanceIds, []);
  assert.match(recommendations[0].todos[0], /Import reagent evidence/);
});

test("reagent recommender includes purchase details, provenance, and confidence", () => {
  const recommendations = recommendReagents(hypothesis, [associationEvidence, reagentEvidence]);

  assert.equal(recommendations[0].title, "GENE1 CRISPRi guide set");
  assert.equal(recommendations[0].confidence, 0.6);
  assert.deepEqual(recommendations[0].provenanceIds, ["EV-4"]);
  assert.equal(recommendations[0].purchase.catalogNumber, "EV-G1-KD");
});

test("markdown export preserves recommendation provenance", () => {
  const evidence = [associationEvidence, modelEvidence, reagentEvidence];
  const plan = buildExperimentPlan(hypothesis, evidence);
  const reagents = recommendReagents(hypothesis, evidence);
  const markdown = exportPlanMarkdown(hypothesis, plan, reagents, evidence);

  assert.match(markdown, /Gene-Disease Experiment Plan/);
  assert.match(markdown, /Provenance: EV-1/);
  assert.match(markdown, /EV-G1-KD/);
  assert.match(markdown, /Evidence Provenance/);
});
