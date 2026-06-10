import test from "node:test";
import assert from "node:assert/strict";
import { parseProductCatalogCsv, parseProductCatalogJson } from "../src/platform/productCatalog.js";
import { createRepository } from "../src/platform/store.js";

test("product catalog JSON parser accepts GeneCopoeia product arrays", () => {
  const result = parseProductCatalogJson(JSON.stringify({
    products: [{
      company: "GeneCopoeia",
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      productType: "enzyme",
      applicationArea: "protein chemistry"
    }]
  }));

  assert.equal(result.errors.length, 0);
  assert.equal(result.products[0].productName, "Biotin protein ligase");
});

test("product catalog CSV parser maps rows into product records", () => {
  const csv = [
    "company,productName,catalogNumber,productType,applicationArea,synonyms",
    "GeneCopoeia,CD28,mAb-00712,antibody,\"WB, FC, ELISA\",T cell costimulatory receptor"
  ].join("\n");
  const result = parseProductCatalogCsv(csv);

  assert.equal(result.errors.length, 0);
  assert.equal(result.products[0].catalogNumber, "mAb-00712");
});

test("product catalog CSV parser maps GeneCopoeia vendor catalog headers", () => {
  const csv = [
    "Part ID,Manufacturer SKU,Manufacturer,Product Name,Description,Size,List price ,Product URL,Datasheet URL,Category,Shipping condition,Storage condition",
    "AA001-025,AA001-025,GeneCopoeia,\"eGFP-AV01 AAVPrime" + "\uFFFD" + " Purified AAV Particles (Old Cat # AA001)\",\"AAV particles\",25 ul,$379,https://www.genecopoeia.com/product/aavprime,https://www.genecopoeia.com/protocol.pdf,Premade AAV particle,Dry ice,-80 C"
  ].join("\n");
  const result = parseProductCatalogCsv(csv);
  const repository = createRepository();
  const imported = repository.importProducts(result.products);
  const product = repository.snapshot().products[0];

  assert.equal(result.errors.length, 0);
  assert.equal(result.products[0].company, "GeneCopoeia");
  assert.equal(result.products[0].productName, "eGFP-AV01 AAVPrime Purified AAV Particles (Old Cat # AA001)");
  assert.equal(result.products[0].catalogNumber, "AA001-025");
  assert.equal(result.products[0].productType, "Premade AAV particle");
  assert.equal(result.products[0].applicationArea, "Premade AAV particle");
  assert.deepEqual(result.products[0].synonyms, ["AA001"]);
  assert.equal(imported.imported, 1);
  assert.equal(product.productUrl, "https://www.genecopoeia.com/product/aavprime");
  assert.equal(product.storageCondition, "-80 C");
});

test("repository can restore a locally persisted workspace snapshot", () => {
  const repository = createRepository();
  const restored = repository.restoreSnapshot({
    products: [{
      company: "GeneCopoeia",
      productName: "CD28",
      catalogNumber: "mAb-00712",
      productType: "antibody",
      applicationArea: "WB, FC, ELISA"
    }],
    evidence: [],
    salesRecords: []
  });

  assert.equal(restored.products.length, 1);
  assert.equal(repository.snapshot().products[0].productName, "CD28");
});

test("workspace restore preserves stored evidence product links", () => {
  const repository = createRepository();
  const restored = repository.restoreSnapshot({
    products: [{
      id: "GENECOPOEIA-BI001",
      company: "GeneCopoeia",
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      productType: "enzyme",
      applicationArea: "protein chemistry"
    }],
    evidence: [{
      id: "EPMC-1",
      sourceType: "publication",
      sourceTitle: "Europe PMC: Product-use record",
      sourceUrl: "https://europepmc.org/article/MED/1",
      date: "2026-01-01",
      snippet: "Stored Europe PMC candidate mentioning GeneCopoeia BI001.",
      contextLabel: "core_method",
      confidenceScore: 0.3,
      reviewStatus: "candidate",
      products: [{
        productId: "GENECOPOEIA-BI001",
        productName: "Biotin protein ligase",
        matchedText: "BI001",
        mentionType: "catalog_number",
        confidence: 0.99
      }]
    }],
    salesRecords: []
  });

  assert.equal(restored.evidence.length, 1);
  assert.equal(restored.evidence[0].products[0].productId, "GENECOPOEIA-BI001");
});

test("bulk product import upserts records into the local registry", () => {
  const repository = createRepository();
  const first = repository.importProducts([{
    id: "GENECOPOEIA-CD28",
    company: "GeneCopoeia",
    productName: "CD28",
    catalogNumber: "mAb-00712",
    productType: "antibody",
    applicationArea: "flow cytometry"
  }]);
  const second = repository.importProducts([{
    id: "GENECOPOEIA-CD28",
    company: "GeneCopoeia",
    productName: "CD28",
    catalogNumber: "mAb-00712",
    productType: "antibody",
    applicationArea: "WB, FC, ELISA"
  }]);

  assert.equal(first.imported, 1);
  assert.equal(second.imported, 1);
  assert.equal(repository.snapshot().products.length, 1);
  assert.equal(repository.snapshot().products[0].applicationArea, "WB, FC, ELISA");
});
