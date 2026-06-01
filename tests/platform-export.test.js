import test from "node:test";
import assert from "node:assert/strict";
import { resolveEvidenceExportFilters } from "../src/platform/exportFilters.js";
import {
  exportEvidenceCsv,
  exportEvidenceFilename,
  exportProductEvidenceCsv,
  exportProductsCsv
} from "../src/platform/reporting.js";

const products = [{
  id: "PROD-PA001",
  company: "GeneCopoeia",
  productName: "OmicsArray Systemic array",
  catalogNumber: "PA001",
  rrid: "",
  productType: "microarray",
  applicationArea: "protein microarray",
  synonyms: [],
  competitorEquivalents: [],
  internalOwner: "Commercial Ops"
}, {
  id: "PROD-BI001",
  company: "GeneCopoeia",
  productName: "Biotin protein ligase",
  catalogNumber: "BI001",
  rrid: "",
  productType: "enzyme",
  applicationArea: "protein chemistry",
  synonyms: [],
  competitorEquivalents: [],
  internalOwner: "Commercial Ops"
}];

test("CSV export includes catalog number and product name columns", () => {
  const csv = exportEvidenceCsv([{
    id: "EV-PA001",
    sourceType: "publication",
    sourceTitle: "Europe PMC: product-use record",
    sourceId: "123",
    date: "2026-01-02",
    authors: ["Curator A"],
    institution: "Example Institute",
    contextLabel: "core_method",
    reviewStatus: "candidate",
    confidenceScore: 0.3,
    products: [{
      productId: "PROD-PA001",
      productName: "Old display name"
    }]
  }], products);

  const [header, row] = csv.split("\n");
  assert.match(header, /^id,catalogNumber,productName,sourceType/);
  assert.match(row, /^EV-PA001,PA001,OmicsArray Systemic array,publication/);
  assert.doesNotMatch(row, /Old display name/);
});

test("CSV export filename is based on selected catalog and product name", () => {
  assert.equal(
    exportEvidenceFilename(products[0]),
    "genecopoeia-PA001-OmicsArray-Systemic-array-evidence.csv"
  );
  assert.equal(exportEvidenceFilename(), "genecopoeia-evidence.csv");
});

test("CSV export filters can resolve product by catalog number and product name", () => {
  const filters = resolveEvidenceExportFilters(products, new URLSearchParams({
    catalogNumber: "PA001",
    productName: "OmicsArray Systemic array",
    reviewStatus: "candidate"
  }));

  assert.equal(filters.productId, "PROD-PA001");
  assert.equal(filters.reviewStatus, "candidate");
});

test("products CSV exports every registry product into one file", () => {
  const csv = exportProductsCsv(products.map((product) => ({
    ...product,
    company: "GeneCopoeia",
    rrid: "",
    productType: "reagent",
    applicationArea: "protein chemistry",
    synonyms: ["Syn A", "Syn B"],
    competitorEquivalents: ["Competitor X"],
    internalOwner: "Commercial Ops",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z"
  })));
  const lines = csv.split("\n");

  assert.match(lines[0], /^id,company,productName,catalogNumber,rrid,productType,applicationArea/);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /PROD-PA001,GeneCopoeia,OmicsArray Systemic array,PA001/);
  assert.match(lines[2], /PROD-BI001,GeneCopoeia,Biotin protein ligase,BI001/);
  assert.match(lines[1], /Syn A; Syn B/);
});

test("combined product-evidence CSV exports every product with linked evidence", () => {
  const csv = exportProductEvidenceCsv(products, [{
    id: "EV-PA001",
    sourceType: "publication",
    sourceTitle: "Europe PMC: current systemic array record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    sourceId: "1",
    date: "2026-01-02",
    authors: ["Curator A"],
    institution: "Example Institute",
    country: "US",
    contextLabel: "core_method",
    reviewStatus: "candidate",
    connectorId: "europepmc_fulltext_publications",
    confidenceScore: 0.3,
    productMentionType: "connector_candidate",
    products: [{
      productId: "PROD-PA001",
      productName: "OmicsArray Systemic array",
      matchedText: "PA001",
      confidence: 0.95
    }],
    competitorMentions: [{
      productId: "PROD-PA001",
      competitorName: "Competitor X"
    }],
    rawPayload: { query: "GeneCopoeia PA001" }
  }]);
  const lines = csv.split("\n");

  assert.match(lines[0], /^productId,company,productName,catalogNumber,rrid,productType/);
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^PROD-PA001,GeneCopoeia,OmicsArray Systemic array,PA001/);
  assert.match(lines[1], /EV-PA001,publication,Europe PMC: current systemic array record/);
  assert.match(lines[1], /PA001,0.95,Competitor X/);
  assert.match(lines[2], /^PROD-BI001,GeneCopoeia,Biotin protein ligase,BI001/);
  assert.match(lines[2], /,,,,,,,,,,,,,,,,,$/);
});
