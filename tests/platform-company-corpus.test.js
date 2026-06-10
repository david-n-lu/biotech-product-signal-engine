import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_EVIDENCE_CORPUS_HEADERS,
  companyCorpusStats,
  exportCompanyCorpusCsv,
  importCompanyCorpusCsvText,
  linkCompanyCorpusRecordsToProducts
} from "../src/platform/companyCorpus.js";

const aa320 = {
  id: "PROD-AA320",
  company: "GeneCopoeia",
  productName: "AAVPrime AAV Serotype Testing Kit",
  catalogNumber: "AA320",
  rrid: "",
  productType: "kit",
  applicationArea: "AAV",
  synonyms: ["Adeno-associated virus Serotype Testing Kit"],
  competitorEquivalents: [],
  internalOwner: "Commercial Ops"
};

test("company corpus CSV uses the product evidence export shape", () => {
  const csv = exportCompanyCorpusCsv([{
    id: "CORPUS-AA320",
    connectorId: "europepmc_fulltext_publications",
    sourceType: "publication",
    sourceTitle: "Europe PMC: AAV serotype record",
    sourceUrl: "https://europepmc.org/article/MED/34035265",
    sourceId: "34035265",
    date: "2021-05-25",
    authors: ["Curator A"],
    institution: "Example Institute",
    contextLabel: "unclear",
    europePmcSentences: "The kit was purchased from GeneCopoeia, catalog # AA320.",
    reviewStatus: "candidate",
    confidenceScore: 0.3,
    productMentionType: "company_context"
  }]);
  const [header, row] = csv.split("\n");

  assert.equal(header, PRODUCT_EVIDENCE_CORPUS_HEADERS.join(","));
  assert.match(row, /^,GeneCopoeia,,,,,,,,,CORPUS-AA320,publication/);
  assert.match(row, /GeneCopoeia, catalog # AA320/);
});

test("saved company corpus relinks future products by Europe PMC sentence context", () => {
  const corpusCsv = exportCompanyCorpusCsv([{
    id: "CORPUS-AA320",
    connectorId: "europepmc_fulltext_publications",
    sourceType: "publication",
    sourceTitle: "Europe PMC: AAV serotype record",
    sourceUrl: "https://europepmc.org/article/MED/34035265",
    sourceId: "34035265",
    date: "2021-05-25",
    authors: ["Curator A"],
    institution: "Example Institute",
    europePmcSentences: "AAV serotypes were compared using an Adeno-associated virus Serotype Testing Kit (GeneCopoeia, catalog # AA320).",
    reviewStatus: "candidate",
    confidenceScore: 0.3,
    productMentionType: "company_context"
  }]);
  const parsed = importCompanyCorpusCsvText(corpusCsv);
  const linked = linkCompanyCorpusRecordsToProducts(parsed.records, [aa320], {
    now: new Date("2026-06-08T12:00:00Z")
  });

  assert.equal(parsed.errors.length, 0);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].products[0].productId, "PROD-AA320");
  assert.equal(linked[0].products[0].matchedText, "AA320");
  assert.equal(linked[0].reviewStatus, "candidate");
  assert.equal(linked[0].rawPayload.sourceCorpus, "local_europe_pmc_10y");
});

test("saved company corpus relink rejects conflicting same-family catalog numbers", () => {
  const parsed = importCompanyCorpusCsvText(exportCompanyCorpusCsv([{
    id: "CORPUS-LT002",
    connectorId: "europepmc_fulltext_publications",
    sourceType: "publication",
    sourceTitle: "Europe PMC: lentiviral packaging record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    sourceId: "1",
    europePmcSentences: "Lentivirus was produced using Lenti-Pac HIV expression packaging kit following the manufacturer's protocol (GeneCopoeia, LT002).",
    confidenceScore: 0.3
  }]));
  const linked = linkCompanyCorpusRecordsToProducts(parsed.records, [{
    id: "PROD-LT001",
    company: "GeneCopoeia",
    productName: "Lenti-Pac HIV Expression Packaging Kit",
    catalogNumber: "LT001",
    productType: "kit",
    applicationArea: "lentivirus",
    synonyms: []
  }]);

  assert.equal(linked.length, 0);
});

test("company corpus stats count records and unique sources", () => {
  assert.deepEqual(companyCorpusStats([
    { id: "A", sourceId: "1", europePmcSentences: "GeneCopoeia AA320." },
    { id: "B", sourceId: "1", europePmcSentences: "GeneCopoeia SCQP00002." }
  ]), {
    records: 2,
    sources: 1,
    contexts: 2
  });
});
