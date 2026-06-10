import test from "node:test";
import assert from "node:assert/strict";
import { buildLocalWorkspaceSnapshot, resolveSavedSelectedProductId } from "../src/platform/localWorkspace.js";

test("local workspace snapshot saves product details by product id", () => {
  const snapshot = buildLocalWorkspaceSnapshot({
    selectedProductId: "PROD-PA001",
    filters: { productId: "PROD-PA001" },
    products: [{
      id: "PROD-PA001",
      company: "GeneCopoeia",
      productName: "OmicsArray Systemic array",
      catalogNumber: "PA001",
      productType: "microarray",
      applicationArea: "protein microarray",
      synonyms: []
    }, {
      id: "PROD-BI001",
      company: "GeneCopoeia",
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      productType: "enzyme",
      applicationArea: "protein chemistry",
      synonyms: []
    }],
    evidence: [{
      id: "EV-PA001",
      sourceTitle: "Europe PMC: current systemic array record",
      snippet: "Europe PMC matched GeneCopoeia PA001.",
      europePmcSentences: "Cells were profiled with GeneCopoeia PA001 in the methods section.",
      products: [{
        productId: "PROD-PA001",
        productName: "OmicsArray Systemic array",
        matchedText: "PA001"
      }],
      rawPayload: { query: "GeneCopoeia PA001" }
    }, {
      id: "EV-BI001",
      sourceTitle: "Europe PMC: biotin ligase record",
      snippet: "Europe PMC matched GeneCopoeia BI001.",
      europePmcSentences: "The labeling reaction used GeneCopoeia BI001 biotin protein ligase.",
      products: [{
        productId: "PROD-BI001",
        productName: "Biotin protein ligase",
        matchedText: "BI001"
      }],
      rawPayload: { query: "GeneCopoeia BI001" }
    }],
    salesRecords: [{
      id: "SALE-PA001",
      productId: "PROD-PA001",
      accountName: "Example Lab"
    }],
    summary: { productId: "PROD-PA001", sections: [{ title: "Who is using it?", text: "Example Lab." }] }
  }, new Date("2026-05-29T12:00:00Z"));

  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.selectedProductId, "PROD-PA001");
  assert.deepEqual(Object.keys(snapshot.productDetails).sort(), ["PROD-BI001", "PROD-PA001"]);
  assert.deepEqual(snapshot.productDetails["PROD-PA001"].evidence.map((record) => record.id), ["EV-PA001"]);
  assert.deepEqual(snapshot.productDetails["PROD-BI001"].evidence.map((record) => record.id), ["EV-BI001"]);
  assert.equal(snapshot.productDetails["PROD-PA001"].summary.productId, "PROD-PA001");
  assert.equal(snapshot.productDetails["PROD-BI001"].summary, null);
});

test("local workspace snapshot does not preserve synthetic Europe PMC query rows", () => {
  const snapshot = buildLocalWorkspaceSnapshot({
    selectedProductId: "PROD-PA001",
    products: [{
      id: "PROD-PA001",
      company: "GeneCopoeia",
      productName: "OmicsArray Systemic array",
      catalogNumber: "PA001",
      productType: "microarray",
      applicationArea: "protein microarray",
      synonyms: []
    }],
    evidence: [{
      id: "EV-SYNTHETIC",
      sourceTitle: "Europe PMC: broad metadata hit",
      sourceUrl: "https://europepmc.org/article/MED/1",
      connectorId: "europepmc_fulltext_publications",
      snippet: "Europe PMC matched GeneCopoeia PA001 in publication metadata or searchable full text. The abstract only mentions pathway analysis.",
      products: [{
        productId: "PROD-PA001",
        productName: "OmicsArray Systemic array",
        matchedText: "PA001"
      }]
    }, {
      id: "EV-REAL",
      sourceTitle: "Europe PMC: product-use record",
      sourceUrl: "https://europepmc.org/article/MED/2",
      connectorId: "europepmc_fulltext_publications",
      europePmcSentences: "Cells used GeneCopoeia PA001 in the methods section.",
      products: [{
        productId: "PROD-PA001",
        productName: "OmicsArray Systemic array",
        matchedText: "PA001"
      }]
    }],
    salesRecords: []
  }, new Date("2026-05-29T12:00:00Z"));

  assert.deepEqual(snapshot.evidence.map((record) => record.id), ["EV-REAL"]);
  assert.deepEqual(snapshot.productDetails["PROD-PA001"].evidence.map((record) => record.id), ["EV-REAL"]);
});

test("local workspace restores the selected product when it still exists", () => {
  const products = [{ id: "PROD-PA001" }, { id: "PROD-BI001" }];

  assert.equal(resolveSavedSelectedProductId({ selectedProductId: "PROD-BI001" }, products), "PROD-BI001");
  assert.equal(resolveSavedSelectedProductId({ filters: { productId: "PROD-PA001" } }, products), "PROD-PA001");
  assert.equal(resolveSavedSelectedProductId({ selectedProductId: "MISSING" }, products), "");
});
