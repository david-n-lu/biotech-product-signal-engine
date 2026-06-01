import test from "node:test";
import assert from "node:assert/strict";
import { extractEntities, matchCompetitors, matchProducts, searchProducts } from "../src/platform/matching.js";
import { SYNTHETIC_DEMO_DATA } from "../src/platform/sampleData.js";

const products = SYNTHETIC_DEMO_DATA.products;

test("product search matches company, catalog number, RRID, and synonyms", () => {
  assert.ok(searchProducts("GeneCopoeia", products).length >= 5);
  assert.equal(searchProducts("LF001", products)[0].product.id, "GC-LUC-PAIR");
  assert.equal(searchProducts("RRID:AB_3099005", products)[0].product.id, "GC-EXOFECT");
  assert.equal(searchProducts("Duo-Luciferase Kit", products)[0].product.id, "GC-LUC-PAIR");
});

test("text matching finds exact product names, catalog numbers, RRIDs, and fuzzy synonyms", () => {
  const matches = matchProducts(products, "Methods used a LucPair assay LF001 and RRID:AB_3099004.");

  assert.ok(matches.some((match) => match.productId === "GC-LUC-PAIR" && match.mentionType === "catalog_number"));
  assert.ok(matches.some((match) => match.productId === "GC-LUC-PAIR" && match.mentionType === "rrid"));
  assert.ok(matches.some((match) => match.productId === "GC-LUC-PAIR" && match.mentionType === "fuzzy_synonym"));
});

test("competitor matching remains linked to product equivalents", () => {
  const matches = matchCompetitors(products, "The workflow benchmarked Promega Dual-Luciferase Reporter Assay.");

  assert.equal(matches[0].productId, "GC-LUC-PAIR");
  assert.equal(matches[0].competitorName, "Promega Dual-Luciferase Reporter Assay");
});

test("entity extraction identifies catalog-like strings and RRIDs", () => {
  const entities = extractEntities("Catalog EXFT10A-1 is listed with RRID:AB_3099005.");

  assert.ok(entities.catalogNumbers.includes("EXFT10A-1"));
  assert.ok(entities.rrids.includes("RRID:AB_3099005"));
});
