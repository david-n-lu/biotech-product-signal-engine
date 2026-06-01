import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAlerts } from "../src/platform/alerts.js";
import { scoreLeads } from "../src/platform/leadScoring.js";
import { SYNTHETIC_DEMO_DATA } from "../src/platform/sampleData.js";
import { buildProductSummary } from "../src/platform/summaries.js";
import { hydrateState } from "../src/platform/store.js";

test("lead scoring returns explainable account recommendations", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const leads = scoreLeads(state);

  assert.ok(leads[0].score > 0);
  assert.ok(leads[0].confidence > 0);
  assert.ok(leads[0].topContributingFeatures.length > 0);
  assert.ok(leads[0].evidenceIds.length + leads[0].salesRecordIds.length > 0);
});

test("summaries are grounded in stored product evidence", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const summary = buildProductSummary(state, "GC-LUC-PAIR");

  assert.equal(summary.productId, "GC-LUC-PAIR");
  assert.ok(summary.confidence > 0);
  assert.ok(summary.provenanceIds.includes("SYN-PROT-002"));
  assert.ok(summary.sections.some((section) => /East Harbor/.test(section.text)));
});

test("alert evaluation flags scientific and sales activity with provenance", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const alerts = evaluateAlerts(state, state.alertRules);

  assert.ok(alerts.some((alert) => alert.ruleType === "new_high_impact_paper" && alert.evidenceIds.length));
  assert.ok(alerts.some((alert) => alert.ruleType === "new_patent_mention" && alert.evidenceIds.includes("SYN-PAT-004")));
  assert.ok(alerts.some((alert) => alert.ruleType === "major_account_reactivation" && alert.salesRecordIds.length));
});
