import test from "node:test";
import assert from "node:assert/strict";
import { importEvidenceFromJson, mergeEvidence } from "../src/evidence/connectors.js";
import { validateEvidenceRecord } from "../src/evidence/validation.js";
import { associationEvidence } from "./fixtures.js";

test("valid evidence requires provenance and confidence", () => {
  const result = validateEvidenceRecord(associationEvidence);

  assert.equal(result.error, undefined);
  assert.equal(result.record.id, "EV-1");
  assert.equal(result.record.confidence, 0.8);
  assert.equal(result.record.source.url, "https://example.org/association");
});

test("evidence without provenance is rejected", () => {
  const result = validateEvidenceRecord({
    ...associationEvidence,
    source: { title: "Missing locator", accessedAt: "2026-05-25" }
  });

  assert.match(result.error, /source\.url or source\.citation/);
});

test("json connector parses arrays and reports invalid json", () => {
  const parsed = importEvidenceFromJson(JSON.stringify([associationEvidence]));
  const invalid = importEvidenceFromJson("{not json");

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.errors.length, 0);
  assert.equal(invalid.records.length, 0);
  assert.match(invalid.errors[0], /could not be parsed/);
});

test("mergeEvidence replaces records with matching ids", () => {
  const merged = mergeEvidence([associationEvidence], [{
    ...associationEvidence,
    claim: "Updated claim"
  }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].claim, "Updated claim");
});
