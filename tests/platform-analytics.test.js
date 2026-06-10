import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, computeRepeatPurchaseRate } from "../src/platform/analytics.js";
import { hydrateState } from "../src/platform/store.js";
import { SYNTHETIC_DEMO_DATA } from "../src/platform/sampleData.js";

test("analytics computes source, institution, share-of-voice, and product metrics with provenance", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const analytics = buildAnalytics(state);

  assert.equal(analytics.overview.totalProducts.value, 5);
  assert.ok(analytics.mentionsBySourceType.some((row) => row.label === "publication" && row.provenanceIds.length));
  assert.ok(analytics.topInstitutions[0].provenanceIds.length > 0);
  assert.ok(analytics.shareOfVoice.some((row) => row.label === "GeneCopoeia products"));
  assert.ok(analytics.productPerformance.some((row) => row.productId === "GC-LUC-PAIR" && row.salesRecordIds.length));
});

test("analytics filters by product and source type", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const analytics = buildAnalytics(state, {
    productId: "GC-LUC-PAIR",
    sourceType: "publication"
  });

  assert.ok(analytics.overview.totalMentions.value >= 1);
  assert.equal(analytics.overview.totalProducts.value, 1);
  assert.deepEqual(analytics.productPerformance.map((row) => row.productId), ["GC-LUC-PAIR"]);
  assert.ok(analytics.productPerformance.find((row) => row.productId === "GC-LUC-PAIR").mentions >= 1);
  assert.equal(analytics.mentionsBySourceType[0].label, "publication");
});

test("analytics product KPI and mentions use current product identity", () => {
  const state = hydrateState({
    products: [{
      id: "GC-REUSED",
      company: "GeneCopoeia",
      productName: "OmicsArray Systemic array",
      catalogNumber: "PA001",
      productType: "microarray",
      applicationArea: "protein microarray",
      synonyms: []
    }],
    evidence: [
      {
        id: "EV-OLD",
        sourceType: "publication",
        sourceTitle: "Europe PMC: old biotin ligase record",
        sourceId: "OLD",
        date: "2026-01-01",
        snippet: "Europe PMC matched GeneCopoeia BI001 biotin protein ligase.",
        products: [{
          productId: "GC-REUSED",
          productName: "Biotin protein ligase",
          matchedText: "biotin protein ligase"
        }],
        rawPayload: {
          query: "GeneCopoeia BI001",
          productName: "Biotin protein ligase"
        }
      },
      {
        id: "EV-CURRENT",
        sourceType: "publication",
        sourceTitle: "Europe PMC: current systemic array record",
        sourceId: "CURRENT",
        date: "2026-01-02",
        snippet: "Europe PMC matched GeneCopoeia PA001.",
        europePmcSentences: "Cells were profiled with GeneCopoeia PA001 in the methods section.",
        products: [{
          productId: "GC-REUSED",
          productName: "OmicsArray Systemic array",
          matchedText: "PA001"
        }],
        rawPayload: {
          query: "GeneCopoeia PA001",
          productName: "OmicsArray Systemic array"
        }
      }
    ],
    salesRecords: []
  });

  const analytics = buildAnalytics(state, { productId: "GC-REUSED" });

  assert.equal(analytics.overview.totalProducts.value, 1);
  assert.equal(analytics.overview.totalMentions.value, 1);
  assert.deepEqual(analytics.overview.totalMentions.provenanceIds, ["EV-CURRENT"]);
  assert.equal(analytics.productPerformance[0].mentions, 1);
});

test("repeat purchase rate is explainable back to sales records", () => {
  const state = hydrateState(SYNTHETIC_DEMO_DATA);
  const metric = computeRepeatPurchaseRate(state.salesRecords);

  assert.ok(metric.value > 0);
  assert.ok(metric.provenanceIds.includes("SYN-SALE-002"));
  assert.match(metric.explanation, /product-account pairs/);
});
