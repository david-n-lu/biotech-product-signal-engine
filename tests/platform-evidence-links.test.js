import test from "node:test";
import assert from "node:assert/strict";
import { getEvidenceSourceLink } from "../src/platform/evidenceLinks.js";

test("evidence source link exposes Europe PMC URLs for clickable evidence rows", () => {
  const link = getEvidenceSourceLink({
    sourceType: "publication",
    sourceTitle: "Europe PMC: Example product-use article",
    sourceUrl: "https://europepmc.org/article/MED/12345"
  });

  assert.equal(link.href, "https://europepmc.org/article/MED/12345");
  assert.equal(link.label, "publication: Europe PMC: Example product-use article");
  assert.equal(link.isEuropePmc, true);
});

test("evidence source link falls back to text when no URL is stored", () => {
  const link = getEvidenceSourceLink({
    sourceType: "grant",
    sourceTitle: "Stored grant without URL",
    sourceId: "GRANT-1"
  });

  assert.equal(link.href, "");
  assert.equal(link.label, "grant: Stored grant without URL");
  assert.equal(link.isEuropePmc, false);
});
