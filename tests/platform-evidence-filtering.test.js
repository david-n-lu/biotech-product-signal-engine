import test from "node:test";
import assert from "node:assert/strict";
import { evidenceForProduct } from "../src/platform/evidenceFiltering.js";
import { createRepository } from "../src/platform/store.js";

const records = [
  {
    id: "EV-1",
    products: [{ productId: "GC-BIRA", productName: "Biotin protein ligase" }]
  },
  {
    id: "EV-2",
    products: [{ productId: "GC-CD28", productName: "CD28" }]
  },
  {
    id: "EV-3",
    products: [
      { productId: "GC-BIRA", productName: "Biotin protein ligase" },
      { productId: "GC-CD28", productName: "CD28" }
    ]
  },
  {
    id: "EV-4",
    products: []
  }
];

test("evidence explorer rows require a searched or selected product", () => {
  assert.deepEqual(evidenceForProduct(records, "").map((record) => record.id), []);
});

test("evidence explorer rows stay scoped to the selected local product", () => {
  assert.deepEqual(evidenceForProduct(records, "GC-BIRA").map((record) => record.id), ["EV-1", "EV-3"]);
  assert.deepEqual(evidenceForProduct(records, "GC-CD28").map((record) => record.id), ["EV-2", "EV-3"]);
});

test("evidence explorer excludes stale records left on a reused product id", () => {
  const currentProduct = {
    id: "GC-REUSED",
    productName: "OmicsArray Systemic array",
    catalogNumber: "PA001",
    rrid: "",
    synonyms: []
  };
  const reusedIdRecords = [
    {
      id: "EV-OLD",
      sourceTitle: "Europe PMC: old biotin ligase record",
      snippet: "Europe PMC matched GeneCopoeia BI001 biotin protein ligase.",
      products: [{
        productId: "GC-REUSED",
        productName: "OmicsArray Systemic array",
        matchedText: "biotin protein ligase"
      }],
      rawPayload: {
        query: "GeneCopoeia BI001",
        productName: "Biotin protein ligase"
      }
    },
    {
      id: "EV-CURRENT",
      sourceTitle: "Europe PMC: current systemic array record",
      snippet: "Europe PMC matched GeneCopoeia PA001.",
      products: [{
        productId: "GC-REUSED",
        productName: "OmicsArray Systemic array",
        matchedText: "OmicsArray Systemic array"
      }],
      rawPayload: {
        query: "GeneCopoeia PA001",
        productName: "OmicsArray Systemic array"
      }
    }
  ];

  assert.deepEqual(evidenceForProduct(reusedIdRecords, currentProduct).map((record) => record.id), ["EV-CURRENT"]);
});

test("repository evidence product filter excludes stale stored product identities", () => {
  const currentProduct = {
    id: "GC-REUSED",
    company: "GeneCopoeia",
    productName: "OmicsArray Systemic array",
    catalogNumber: "PA001",
    productType: "microarray",
    applicationArea: "protein microarray",
    synonyms: []
  };
  const repository = createRepository({
    products: [currentProduct],
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

  assert.deepEqual(repository.listEvidence({ productId: "GC-REUSED" }).map((record) => record.id), ["EV-CURRENT"]);
});
