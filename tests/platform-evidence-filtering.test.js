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
      europePmcSentences: "Cells were profiled with GeneCopoeia PA001 in the methods section.",
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

test("evidence explorer excludes Europe PMC rows without real GeneCopoeia context", () => {
  const currentProduct = {
    id: "GC-PA001",
    productName: "OmicsArray Systemic array",
    catalogNumber: "PA001",
    rrid: "",
    synonyms: []
  };
  const candidateRows = [
    {
      id: "EV-SYNTHETIC",
      sourceTitle: "Europe PMC: broad metadata hit",
      sourceUrl: "https://europepmc.org/article/MED/1",
      connectorId: "europepmc_fulltext_publications",
      snippet: "Europe PMC matched GeneCopoeia PA001 in publication metadata or searchable full text. The abstract discusses pathway analysis only.",
      products: [{
        productId: "GC-PA001",
        productName: "OmicsArray Systemic array",
        matchedText: "PA001"
      }],
      rawPayload: {
        query: "GeneCopoeia PA001",
        productName: "OmicsArray Systemic array"
      }
    },
    {
      id: "EV-REAL",
      sourceTitle: "Europe PMC: product-use record",
      sourceUrl: "https://europepmc.org/article/MED/2",
      connectorId: "europepmc_fulltext_publications",
      europePmcSentences: "Cells were analyzed with GeneCopoeia PA001 as described by the manufacturer.",
      products: [{
        productId: "GC-PA001",
        productName: "OmicsArray Systemic array",
        matchedText: "PA001"
      }],
      rawPayload: {
        query: "GeneCopoeia PA001",
        productName: "OmicsArray Systemic array"
      }
    }
  ];

  assert.deepEqual(evidenceForProduct(candidateRows, currentProduct).map((record) => record.id), ["EV-REAL"]);
});

test("evidence explorer requires Europe PMC product context in the extracted sentence", () => {
  const currentProduct = {
    id: "GC-AA320",
    productName: "AAVPrime AAV Serotype Testing Kit",
    catalogNumber: "AA320",
    rrid: "",
    synonyms: []
  };
  const rows = [{
    id: "EV-WRONG-PRODUCT",
    sourceTitle: "Europe PMC: qPCR-only GeneCopoeia record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "Quantitative-PCR was performed using a quantitative RT-PCR Detection Kit (GeneCopoeia, Rockville, MD) according to the manufacturer's instructions.",
    products: [{
      productId: "GC-AA320",
      productName: "AAVPrime AAV Serotype Testing Kit",
      matchedText: "AAVPrime AAV Serotype Testing Kit"
    }],
    rawPayload: {
      query: "GeneCopoeia AAVPrime AAV Serotype Testing Kit"
    }
  }, {
    id: "EV-RIGHT-PRODUCT",
    sourceTitle: "Europe PMC: AA320 product-use record",
    sourceUrl: "https://europepmc.org/article/MED/2",
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "The assay used an AAVPrime AAV Serotype Testing Kit (GeneCopoeia, catalog # AA320).",
    products: [{
      productId: "GC-AA320",
      productName: "AAVPrime AAV Serotype Testing Kit",
      matchedText: "AAVPrime AAV Serotype Testing Kit"
    }]
  }];

  assert.deepEqual(evidenceForProduct(rows, currentProduct).map((record) => record.id), ["EV-RIGHT-PRODUCT"]);
});

test("evidence explorer accepts Europe PMC old catalog numbers recorded in product names", () => {
  const currentProduct = {
    id: "GC-AA001-100",
    productName: "eGFP-AV01 AAVPrime Purified AAV Particles, serotype AAV-2, 100 l(Old Cat # AA002)",
    catalogNumber: "AA001-100",
    rrid: "",
    synonyms: []
  };
  const rows = [{
    id: "EV-OLD-CAT",
    sourceTitle: "Europe PMC: old catalog product-use record",
    sourceUrl: "https://europepmc.org/article/MED/3",
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "AAV particles encoding eGFP were purchased from GeneCopoeia (catalog # AA002).",
    products: [{
      productId: "GC-AA001-100",
      productName: currentProduct.productName,
      matchedText: currentProduct.productName
    }]
  }];

  assert.deepEqual(evidenceForProduct(rows, currentProduct).map((record) => record.id), ["EV-OLD-CAT"]);
});

test("evidence explorer rejects Europe PMC rows with conflicting same-family catalog numbers", () => {
  const currentProduct = {
    id: "GC-LT001",
    productName: "Lenti-Pac HIV Expression Packaging Kit",
    catalogNumber: "LT001",
    rrid: "",
    synonyms: []
  };
  const rows = [{
    id: "EV-LT002",
    sourceTitle: "Europe PMC: conflicting catalog product-use record",
    sourceUrl: "https://europepmc.org/article/MED/4",
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "Lentivirus was produced using Lenti-Pac HIV expression packaging kit following the manufacturer's protocol (GeneCopoeia, LT002).",
    products: [{
      productId: "GC-LT001",
      productName: currentProduct.productName,
      matchedText: currentProduct.productName
    }]
  }, {
    id: "EV-LT001",
    sourceTitle: "Europe PMC: matching catalog product-use record",
    sourceUrl: "https://europepmc.org/article/MED/5",
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "Lentivirus was produced using Lenti-Pac HIV expression packaging kit following the manufacturer's protocol (GeneCopoeia, LT001).",
    products: [{
      productId: "GC-LT001",
      productName: currentProduct.productName,
      matchedText: currentProduct.productName
    }]
  }];

  assert.deepEqual(evidenceForProduct(rows, currentProduct).map((record) => record.id), ["EV-LT001"]);
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

  assert.deepEqual(repository.listEvidence({ productId: "GC-REUSED" }).map((record) => record.id), ["EV-CURRENT"]);
});
