import test from "node:test";
import assert from "node:assert/strict";
import { evidenceTableHeaders } from "../src/platform/evidenceTableColumns.js";

test("evidence table places review actions immediately before provenance", () => {
  const headers = evidenceTableHeaders();

  assert.equal(headers.indexOf("Actions"), headers.indexOf("Provenance") - 1);
});

test("evidence table exposes Europe PMC nearby sentences", () => {
  const headers = evidenceTableHeaders();

  assert.equal(headers.indexOf("Europe PMC sentences"), headers.indexOf("Context") + 1);
});
