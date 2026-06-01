import test from "node:test";
import assert from "node:assert/strict";
import { evidenceTableHeaders } from "../src/platform/evidenceTableColumns.js";

test("evidence table places review actions immediately before provenance", () => {
  const headers = evidenceTableHeaders();

  assert.equal(headers.indexOf("Actions"), headers.indexOf("Provenance") - 1);
});
