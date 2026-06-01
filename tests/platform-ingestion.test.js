import test from "node:test";
import assert from "node:assert/strict";
import { classifyCitationContext } from "../src/platform/classifier.js";
import { importEvidenceFromCsvText, importEvidenceFromJsonText } from "../src/platform/ingestion.js";
import { SYNTHETIC_DEMO_DATA } from "../src/platform/sampleData.js";

const products = SYNTHETIC_DEMO_DATA.products;

test("JSON ingestion normalizes product mentions and citation context", () => {
  const result = importEvidenceFromJsonText(JSON.stringify({
    sourceType: "publication",
    sourceTitle: "Synthetic methods record",
    sourceUrl: "https://example.org/methods",
    date: "2026-05-20",
    institution: "Example University",
    snippet: "Materials and methods used HCP256001-LVSG03 for knockout validation.",
    confidenceScore: 0.8,
    reviewStatus: "curated"
  }), products);

  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].products[0].productId, "GC-CRISPR-KO");
  assert.equal(result.records[0].contextLabel, "core_method");
});

test("CSV ingestion parses rows and caps unreviewed social confidence", () => {
  const csv = [
    "sourceType,sourceTitle,sourceUrl,date,institution,snippet,confidenceScore",
    "social_mention,Synthetic thread,https://example.org/thread,2026-05-21,Example Lab,GeneCopoeia ExoFect kit EXFT10A-1 reorder planned,0.9"
  ].join("\n");
  const result = importEvidenceFromCsvText(csv, products);

  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].products[0].productId, "GC-EXOFECT");
  assert.equal(result.records[0].confidenceScore, 0.55);
});

test("citation context classifier labels negative and comparison mentions", () => {
  assert.equal(classifyCitationContext("The assay produced no signal until lysis timing changed.").label, "negative_mention");
  assert.equal(classifyCitationContext("The kit was compared with an alternative reagent.").label, "comparison");
});
