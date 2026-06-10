import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorScheduler } from "../src/platform/connectorScheduler.js";
import {
  buildBioRxivDetailsUrl,
  buildClinicalTrialsUrl,
  buildEuropePmcFullTextXmlUrl,
  buildEuropePmcSearchUrl,
  buildPubMedFetchUrl,
  buildPatentsViewUrl,
  buildProductQueries,
  buildPubMedSearchUrl,
  buildReporterRequest,
  createConnectorConfigs,
  runSourceConnector,
  runSourceConnectors
} from "../src/platform/sourceConnectors.js";
import { SYNTHETIC_DEMO_DATA } from "../src/platform/sampleData.js";
import { createRepository } from "../src/platform/store.js";

const product = SYNTHETIC_DEMO_DATA.products[0];

test("connector URL builders target primary public APIs", () => {
  assert.equal(new URL(buildPubMedSearchUrl("LF001", 2)).hostname, "eutils.ncbi.nlm.nih.gov");
  assert.equal(new URL(buildPubMedFetchUrl(["123"])).pathname, "/entrez/eutils/efetch.fcgi");
  assert.equal(new URL(buildEuropePmcSearchUrl("GeneCopoeia biotin protein ligase", 2)).hostname, "www.ebi.ac.uk");
  assert.equal(new URL(buildEuropePmcFullTextXmlUrl("PMC", "PMC123456")).pathname, "/europepmc/webservices/rest/PMC123456/fullTextXML");
  assert.equal(new URL(buildBioRxivDetailsUrl("2026-01-01", "2026-05-29", 0)).hostname, "api.biorxiv.org");
  assert.equal(new URL(buildClinicalTrialsUrl("EXFT10A-1", 2)).hostname, "clinicaltrials.gov");
  assert.equal(buildReporterRequest("CRISPR", 2).criteria.advanced_text_search.search_field, "projecttitle,terms,abstracttext");
});

test("connector product queries are Genecopoeia-qualified before generic product terms", () => {
  const cd28Product = {
    ...product,
    productName: "CD28",
    catalogNumber: "",
    rrid: "",
    synonyms: ["T cell costimulatory receptor"]
  };
  const queries = buildProductQueries(cd28Product);
  const pubmedTerm = new URL(buildPubMedSearchUrl(queries[0], 2)).searchParams.get("term");
  const patentsQuery = JSON.parse(new URL(buildPatentsViewUrl(queries[0], 2)).searchParams.get("q"));

  assert.equal(queries[0], "GeneCopoeia CD28");
  assert.match(pubmedTerm, /GeneCopoeia\[Title\/Abstract\] AND CD28\[Title\/Abstract\]/);
  assert.ok(patentsQuery._and);
  assert.deepEqual(patentsQuery._and.map((clause) => clause._text_any.patent_title), ["GeneCopoeia", "CD28"]);
});

test("deep publication queries expand product, company, and cleaned name variants", () => {
  const omicsProduct = {
    ...product,
    productName: "OmicsArray™ Systemic  Array",
    catalogNumber: "PA001",
    rrid: "",
    synonyms: ["Systemic Array", "OmicsArray Systemic Array"]
  };
  const standardQueries = buildProductQueries(omicsProduct);
  const deepQueries = buildProductQueries(omicsProduct, { searchMode: "deep" });
  const deepPubMedTerm = new URL(buildPubMedSearchUrl(deepQueries[0], 2, 0, { searchMode: "deep" })).searchParams.get("term");

  assert.ok(deepQueries.includes("GeneCopoeia PA001"));
  assert.ok(deepQueries.includes("Gene Copoeia PA001"));
  assert.ok(deepQueries.includes("GeneCopoeia OmicsArray Systemic Array"));
  assert.ok(deepQueries.includes("GeneCopoeia Omics Array Systemic Array"));
  assert.ok(deepQueries.length > standardQueries.length);
  assert.match(deepPubMedTerm, /All Fields/);
});

test("PubMed connector imports low-confidence candidate evidence", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "pubmed_publications");
  const result = await runSourceConnector({
    connector,
    products: [product],
    fetchImpl: mockFetch(),
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates[0].sourceType, "publication");
  assert.equal(result.importedCandidates[0].reviewStatus, "candidate");
  assert.ok(result.importedCandidates[0].confidenceScore < 0.4);
  assert.equal(result.importedCandidates[0].productId, product.id);
});

test("deep PubMed connector searches multiple pages while keeping candidate provenance", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "pubmed_publications");
  const fetchImpl = mockDeepPubMedFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "OmicsArray™ Systemic Array",
      catalogNumber: "PA001",
      rrid: "",
      synonyms: []
    }],
    fetchImpl,
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 2,
    searchMode: "deep"
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(fetchImpl.retstarts.slice(0, 3), ["0", "2", "4"]);
  assert.ok(fetchImpl.terms.some((term) => term.includes("[All Fields]")));
  assert.equal(result.importedCandidates.length, 5);
  assert.equal(result.importedCandidates[0].reviewStatus, "candidate");
  assert.ok(result.importedCandidates[0].confidenceScore < 0.4);
});

test("Europe PMC connector imports full-text publication candidates missed by PubMed abstracts", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");

  assert.equal(connector.documentationUrl, "https://europepmc.org/RestfulWebService");

  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: ["BirA"]
    }],
    fetchImpl: mockEuropePmcFetch(),
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 1);
  assert.equal(result.importedCandidates[0].sourceType, "publication");
  assert.equal(result.importedCandidates[0].reviewStatus, "candidate");
  assert.match(result.importedCandidates[0].sourceUrl, /europepmc\.org/);
  assert.equal(result.importedCandidates[0].productName, "Biotin protein ligase");
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia BI001 biotin protein ligase/);
  assert.match(result.importedCandidates[0].snippet, /nearby context/i);
  assert.match(result.importedCandidates[0].snippet, /GeneCopoeia BI001 biotin protein ligase/);

  const repository = createRepository({ products: [{ ...product, productName: "Biotin protein ligase", catalogNumber: "BI001", synonyms: ["BirA"] }], evidence: [], salesRecords: [] });
  repository.ingestEvidence(result.importedCandidates, "source_connectors");
  assert.match(repository.snapshot().evidence[0].europePmcSentences, /GeneCopoeia BI001 biotin protein ligase/);
});

test("Europe PMC connector rejects company mentions without nearby product context", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: ["BirA"]
    }],
    fetchImpl: mockEuropePmcDistantContextFetch(),
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 0);
  assert.match(result.notices[0], /no Genecopoeia-qualified hits/);
});

test("Europe PMC connector extracts the sentence around a GeneCopoeia catalog mention", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");
  const fetchImpl = mockEuropePmcAa320Fetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "AAVPrime AAV Serotype Testing Kit",
      catalogNumber: "AA320",
      synonyms: ["Adeno-associated virus Serotype Testing Kit"]
    }],
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 1);
  assert.equal(fetchImpl.fullTextPath, "/europepmc/webservices/rest/PMC8149856/fullTextXML");
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia, catalog # AA320/);
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia, catalog # SCQP00002/);
  assert.doesNotMatch(result.importedCandidates[0].europePmcSentences, /mammalian brain is highly vulnerable/);
});

test("Europe PMC batch extraction applies to products beyond the first fifty", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");
  const products = Array.from({ length: 52 }, (_, index) => ({
    ...product,
    id: `PROD-BATCH-${index + 1}`,
    productName: `AAV Serotype Testing Kit ${index + 1}`,
    catalogNumber: `AA${String(index + 1).padStart(3, "0")}`,
    synonyms: []
  }));
  const target = products[51];
  const fetchImpl = mockEuropePmcBatchFetch(target.catalogNumber);
  const result = await runSourceConnector({
    connector,
    products,
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 1);
  assert.equal(result.importedCandidates[0].productId, target.id);
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia, catalog # AA052/);
});

test("Europe PMC query keeps Genecopoeia relationship while allowing full-text matches", () => {
  const url = new URL(buildEuropePmcSearchUrl("GeneCopoeia biotin protein ligase", 3));
  assert.equal(url.searchParams.get("query"), "GeneCopoeia AND \"biotin protein ligase\"");
  assert.equal(url.searchParams.get("resultType"), "core");
});

test("exhaustive Europe PMC mode pages 10-year company references and locally links products", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");
  const fetchImpl = mockEuropePmcExhaustiveFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      id: "PROD-BI001",
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: []
    }, {
      ...product,
      id: "PROD-AA320",
      productName: "AAVPrime AAV Serotype Testing Kit",
      catalogNumber: "AA320",
      synonyms: ["Adeno-associated virus Serotype Testing Kit"]
    }, {
      ...product,
      id: "PROD-AA001-100",
      productName: "eGFP-AV01 AAVPrime Purified AAV Particles, serotype AAV-2, 100 l(Old Cat # AA002)",
      catalogNumber: "AA001-100",
      synonyms: []
    }, {
      ...product,
      id: "PROD-LT001",
      productName: "Lenti-Pac HIV Expression Packaging Kit",
      catalogNumber: "LT001",
      synonyms: []
    }],
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 3);
  assert.equal(result.corpusRecords.length, 5);
  assert.deepEqual(fetchImpl.cursorMarks.slice(0, 3), ["*", "cursor-2", "cursor-3"]);
  assert.equal(new URL(fetchImpl.searchUrls[0]).searchParams.get("pageSize"), "1000");
  assert.doesNotMatch(fetchImpl.searchQueries[0], /HAS_FT:y/);
  assert.match(fetchImpl.searchQueries[0], /FIRST_PDATE:\[2016-06-08 TO 2026-06-08\]/);
  assert.doesNotMatch(fetchImpl.searchQueries[0], /BI001|AA320/);
  assert.equal(fetchImpl.fullTextPaths.length, 5);
  assert.ok(result.corpusRecords.every((record) => !record.products.length));
  assert.match(result.corpusRecords.find((record) => record.sourceId === "100005").europePmcSentences, /LT002/);
  assert.deepEqual(result.importedCandidates.map((record) => record.productId).sort(), ["PROD-AA001-100", "PROD-AA320", "PROD-BI001"]);
  const biotinCandidate = result.importedCandidates.find((record) => record.productId === "PROD-BI001");
  const oldCatalogCandidate = result.importedCandidates.find((record) => record.productId === "PROD-AA001-100");
  assert.match(biotinCandidate.europePmcSentences, /GeneCopoeia BI001/);
  assert.match(oldCatalogCandidate.europePmcSentences, /catalog # AA002/);
  assert.equal(biotinCandidate.rawPayload.searchMode, "exhaustive10y");
  assert.equal(biotinCandidate.rawPayload.searchStrategy, "company_first_10y");
  assert.deepEqual(biotinCandidate.rawPayload.searchWindow, {
    source: "Europe PMC",
    startDate: "2016-06-08",
    endDate: "2026-06-08",
    fullTextOnly: false,
    pageSize: 1000
  });
});

test("exhaustive Europe PMC mode can build the company corpus before products are imported", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "europepmc_fulltext_publications");
  const result = await runSourceConnector({
    connector,
    products: [],
    fetchImpl: mockEuropePmcExhaustiveFetch(),
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 0);
  assert.equal(result.corpusRecords.length, 5);
  assert.ok(result.corpusRecords.every((record) => record.productMentionType === "company_context"));
});

test("exhaustive PubMed mode builds a company corpus and links product contexts", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "pubmed_publications");
  const fetchImpl = mockPubMedCompanyCorpusFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      id: "PROD-BI001",
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: []
    }],
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.corpusRecords.length, 1);
  assert.equal(result.corpusRecords[0].connectorId, "pubmed_publications");
  assert.equal(result.corpusRecords[0].rawPayload.sourceCorpus, "local_pubmed_10y");
  assert.equal(result.importedCandidates.length, 1);
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia BI001/);
  assert.match(fetchImpl.terms[0], /All Fields/);
  assert.equal(fetchImpl.dateFilters[0].mindate, "2016-06-08");
});

test("exhaustive bioRxiv mode saves a broad company corpus", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "biorxiv_preprints");
  const result = await runSourceConnector({
    connector,
    products: [],
    fetchImpl: mockBioRxivExhaustiveFetch(),
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 0);
  assert.equal(result.corpusRecords.length, 2);
  assert.ok(result.corpusRecords.every((record) => record.connectorId === "biorxiv_preprints"));
  assert.ok(result.corpusRecords.every((record) => record.rawPayload.sourceCorpus === "local_biorxiv_10y"));
});

test("exhaustive Crossref mode builds a proceedings corpus and links product contexts", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "crossref_conferences");
  const fetchImpl = mockCrossrefCompanyCorpusFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      id: "PROD-LT001",
      productName: "Lenti-Pac HIV Expression Packaging Kit",
      catalogNumber: "LT001",
      synonyms: []
    }],
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.corpusRecords.length, 1);
  assert.equal(result.corpusRecords[0].connectorId, "crossref_conferences");
  assert.equal(result.corpusRecords[0].rawPayload.sourceCorpus, "local_crossref_10y");
  assert.equal(result.importedCandidates.length, 1);
  assert.match(result.importedCandidates[0].europePmcSentences, /GeneCopoeia LT001/);
  assert.equal(fetchImpl.filters[0], "type:proceedings-article,from-pub-date:2016-06-08,until-pub-date:2026-06-08");
});

test("bioRxiv connector imports only Genecopoeia-qualified preprint candidates", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "biorxiv_preprints");

  assert.equal(connector.documentationUrl, "https://api.biorxiv.org/");

  const fetchImpl = mockBioRxivFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: ["BirA"]
    }],
    fetchImpl,
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 2
  });

  assert.equal(result.errors.length, 0);
  assert.equal(fetchImpl.calls(), 1);
  assert.equal(result.importedCandidates.length, 1);
  assert.equal(result.importedCandidates[0].sourceType, "publication");
  assert.equal(result.importedCandidates[0].reviewStatus, "candidate");
  assert.match(result.importedCandidates[0].sourceUrl, /biorxiv\.org/);
  assert.equal(result.importedCandidates[0].sourceId, "10.1101/2026.01.01.123456v1");
  assert.deepEqual(result.importedCandidates[0].authors, ["Curator A", "Curator B"]);
  assert.equal(result.importedCandidates[0].productName, "Biotin protein ligase");
});

test("scheduler saves 10-year Europe PMC company corpus for future product relinking", async () => {
  const products = [{
    ...product,
    id: "PROD-BI001",
    productName: "Biotin protein ligase",
    catalogNumber: "BI001",
    synonyms: []
  }, {
    ...product,
    id: "PROD-AA320",
    productName: "AAVPrime AAV Serotype Testing Kit",
    catalogNumber: "AA320",
    synonyms: ["Adeno-associated virus Serotype Testing Kit"]
  }, {
    ...product,
    id: "PROD-AA001-100",
    productName: "eGFP-AV01 AAVPrime Purified AAV Particles, serotype AAV-2, 100 l(Old Cat # AA002)",
    catalogNumber: "AA001-100",
    synonyms: []
  }, {
    ...product,
    id: "PROD-LT001",
    productName: "Lenti-Pac HIV Expression Packaging Kit",
    catalogNumber: "LT001",
    synonyms: []
  }];
  const repository = createRepository({ products, evidence: [], salesRecords: [] });
  const companyCorpusStore = memoryCompanyCorpusStore();
  const scheduler = createConnectorScheduler(repository, {
    fetchImpl: mockEuropePmcExhaustiveFetch(),
    companyCorpusStore,
    perProductLimit: 1000
  });
  const run = await scheduler.run(["europepmc_fulltext_publications"], products.map((item) => item.id), {
    searchMode: "exhaustive10y",
    perProductLimit: 1000
  });

  assert.equal(run.status, "success");
  assert.equal(run.corpusSaved, 5);
  assert.equal(run.corpusTotal, 5);
  assert.equal(run.corpusLinked, 3);
  assert.equal(run.imported, 3);
  assert.equal(companyCorpusStore.records.length, 5);
  assert.deepEqual(repository.snapshot().evidence.map((record) => record.products[0].productId).sort(), ["PROD-AA001-100", "PROD-AA320", "PROD-BI001"]);
});

test("exhaustive bioRxiv mode pages 10-year preprints for product matches", async () => {
  const connector = createConnectorConfigs().find((item) => item.id === "biorxiv_preprints");
  const fetchImpl = mockBioRxivExhaustiveFetch();
  const result = await runSourceConnector({
    connector,
    products: [{
      ...product,
      productName: "Biotin protein ligase",
      catalogNumber: "BI001",
      synonyms: []
    }],
    fetchImpl,
    now: new Date("2026-06-08T12:00:00Z"),
    perProductLimit: 1000,
    searchMode: "exhaustive10y"
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.importedCandidates.length, 2);
  assert.deepEqual(fetchImpl.cursors, ["0", "2", "3"]);
  assert.deepEqual(fetchImpl.dateWindows[0], {
    fromDate: "2016-06-08",
    toDate: "2026-06-08"
  });
  assert.match(result.importedCandidates[0].sourceUrl, /biorxiv\.org/);
  assert.equal(result.importedCandidates[0].rawPayload.searchMode, "exhaustive10y");
  assert.deepEqual(result.importedCandidates[0].rawPayload.searchWindow, {
    source: "bioRxiv",
    startDate: "2016-06-08",
    endDate: "2026-06-08",
    pageSize: 1000
  });
});

test("patent connector is disabled by default because legacy PatentsView no longer returns JSON", () => {
  const connector = createConnectorConfigs().find((item) => item.id === "patentsview_patents");

  assert.equal(connector.enabled, false);
  assert.equal(connector.requiresConfiguration, true);
  assert.match(connector.description, /legacy PatentsView endpoint/);
});

test("connector runs report no-hit notices instead of pretending PubMed saved evidence", async () => {
  const connectors = createConnectorConfigs().filter((item) => item.id === "pubmed_publications");
  const result = await runSourceConnectors({
    connectors,
    products: [{ ...product, productName: "CD28", catalogNumber: "mAb-00712", synonyms: [] }],
    fetchImpl: mockEmptyFetch(),
    now: new Date("2026-05-29T12:00:00Z"),
    perProductLimit: 1
  });

  assert.equal(result.records.length, 0);
  assert.equal(result.errors.length, 0);
  assert.match(result.notices[0], /no Genecopoeia-qualified hits for CD28/);
  assert.equal(result.runs[0].notices.length, 1);
});

test("scheduler imports connector hits and review workflow promotes curated proof", async () => {
  const repository = createRepository({ products: [product], evidence: [], salesRecords: [] });
  const scheduler = createConnectorScheduler(repository, {
    fetchImpl: mockFetch(),
    perProductLimit: 1
  });

  const run = await scheduler.run(["pubmed_publications"]);
  const evidence = repository.snapshot().evidence;

  assert.equal(run.status, "success");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].reviewStatus, "candidate");

  const reviewed = repository.updateEvidenceReview(evidence[0].id, {
    reviewStatus: "curated",
    confidenceScore: 0.72,
    reviewer: "unit-test"
  });

  assert.equal(reviewed.reviewStatus, "curated");
  assert.equal(reviewed.confidenceScore, 0.72);
  assert.equal(reviewed.reviewer, "unit-test");
});

function mockFetch() {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esearch.fcgi")) {
      return ok({ esearchresult: { idlist: ["12345"] } });
    }
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esummary.fcgi")) {
      return ok({
        result: {
          uids: ["12345"],
          "12345": {
            title: "Automated candidate product mention",
            pubdate: "2026",
            authors: [{ name: "Curator Candidate" }]
          }
        }
      });
    }
    if (parsed.hostname === "api.reporter.nih.gov" && options.method === "POST") {
      return ok({ results: [] });
    }
    return ok({ studies: [], patents: [], message: { items: [] }, results: [] });
  };
}

function mockDeepPubMedFetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esearch.fcgi")) {
      const retstart = Number(parsed.searchParams.get("retstart") || 0);
      fetchImpl.retstarts.push(parsed.searchParams.get("retstart"));
      fetchImpl.terms.push(parsed.searchParams.get("term"));
      const idsByPage = {
        0: ["100", "101"],
        2: ["102", "103"],
        4: ["104"]
      };
      return ok({ esearchresult: { idlist: idsByPage[retstart] || [] } });
    }
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esummary.fcgi")) {
      const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
      return ok({
        result: {
          uids: ids,
          ...Object.fromEntries(ids.map((id) => [id, {
            title: `Deep PubMed candidate ${id}`,
            pubdate: "2026",
            authors: [{ name: `Author ${id}` }]
          }]))
        }
      });
    }
    return ok({});
  };
  fetchImpl.retstarts = [];
  fetchImpl.terms = [];
  return fetchImpl;
}

function mockPubMedCompanyCorpusFetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esearch.fcgi")) {
      fetchImpl.terms.push(parsed.searchParams.get("term"));
      fetchImpl.dateFilters.push({
        mindate: parsed.searchParams.get("mindate"),
        maxdate: parsed.searchParams.get("maxdate")
      });
      return ok({ esearchresult: { idlist: ["777"] } });
    }
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esummary.fcgi")) {
      return ok({
        result: {
          uids: ["777"],
          "777": {
            title: "PubMed GeneCopoeia product-use candidate",
            pubdate: "2024",
            authors: [{ name: "Curator PubMed" }]
          }
        }
      });
    }
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/efetch.fcgi")) {
      return okText([
        "<PubmedArticleSet>",
        "<PubmedArticle>",
        "<MedlineCitation>",
        "<PMID>777</PMID>",
        "<Article><ArticleTitle>PubMed GeneCopoeia product-use candidate</ArticleTitle>",
        "<Abstract><AbstractText>Methods used GeneCopoeia BI001 biotin protein ligase for proximity labeling.</AbstractText></Abstract>",
        "</Article>",
        "</MedlineCitation>",
        "</PubmedArticle>",
        "</PubmedArticleSet>"
      ].join(""));
    }
    return ok({});
  };
  fetchImpl.terms = [];
  fetchImpl.dateFilters = [];
  return fetchImpl;
}

function mockEuropePmcFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/search")) {
      return ok({
        hitCount: 1,
        resultList: {
          result: [{
            pmid: "321",
            pmcid: "PMC123456",
            title: "Genecopoeia biotin ligase candidate",
            firstPublicationDate: "2026-01-02",
            authorString: "Curator A, Curator B",
            abstractText: "This abstract omits the supplier product details.",
            citedByCount: 9
          }]
        }
      });
    }
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/fullTextXML")) {
      return okText([
        "<article><body>",
        "<p>Cells were prepared according to the published protocol.</p>",
        "<p>The labeling reaction used GeneCopoeia BI001 biotin protein ligase for proximity labeling.</p>",
        "<p>Signals were quantified after washing.</p>",
        "</body></article>"
      ].join(""));
    }
    return ok({});
  };
}

function mockEuropePmcDistantContextFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/search")) {
      return ok({
        hitCount: 1,
        resultList: {
          result: [{
            pmid: "654",
            pmcid: "PMC654321",
            title: "Distant supplier and product terms",
            firstPublicationDate: "2026-01-03",
            authorString: "Curator C",
            abstractText: "Metadata returned by Europe PMC."
          }]
        }
      });
    }
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/fullTextXML")) {
      return okText([
        "<article><body>",
        "<p>GeneCopoeia was listed among several suppliers.</p>",
        "<p>Cells were plated overnight.</p>",
        "<p>The assay buffer was replaced.</p>",
        "<p>The BI001 catalog number appeared only in a distant appendix table.</p>",
        "</body></article>"
      ].join(""));
    }
    return ok({});
  };
}

function mockEuropePmcAa320Fetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/search")) {
      return ok({
        hitCount: 1,
        resultList: {
          result: [{
            pmid: "34035265",
            pmcid: "PMC8149856",
            title: "Sulfide catabolism ameliorates hypoxic brain injury.",
            firstPublicationDate: "2021-05-25",
            authorString: "Curator A",
            abstractText: "The mammalian brain is highly vulnerable to oxygen deprivation."
          }]
        }
      });
    }
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/fullTextXML")) {
      fetchImpl.fullTextPath = parsed.pathname;
      return okText([
        "<article><body>",
        "<p>Animals were assigned to treatment groups before surgery.</p>",
        "<p>To determine the most effective AAV serotype for use in the 13LGS brain, we compared the gene transfer efficiency for four AAV serotypes (AAV2, 4, 8, and 9) using an Adeno-associated virus Serotype Testing Kit with eGFP expression as a tag protein (GeneCopoeia, catalog # AA320) to determine the most effective AAV to transfer genes into brains of 13LGS.</p>",
        "<p>Brains of 13LGS were harvested one week after AAV injection ICV and analyzed for eGFP expression by qPCR with a primer set (GeneCopoeia, catalog # SCQP00002).</p>",
        "</body></article>"
      ].join(""));
    }
    return ok({});
  };
  fetchImpl.fullTextPath = "";
  return fetchImpl;
}

function mockEuropePmcBatchFetch(targetCatalogNumber) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/search")) {
      const query = parsed.searchParams.get("query") || "";
      if (!query.includes(targetCatalogNumber)) {
        return ok({ hitCount: 0, resultList: { result: [] } });
      }
      return ok({
        hitCount: 1,
        resultList: {
          result: [{
            pmid: "999999",
            pmcid: "PMC999999",
            title: "Batch product context record",
            firstPublicationDate: "2026-06-08",
            authorString: "Curator Batch",
            abstractText: "Abstract text is not the source of this context."
          }]
        }
      });
    }
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/fullTextXML")) {
      return okText([
        "<article><body>",
        `<p>The methods used GeneCopoeia, catalog # ${targetCatalogNumber}, for the batch-tested product.</p>`,
        "</body></article>"
      ].join(""));
    }
    return ok({});
  };
}

function mockEuropePmcExhaustiveFetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/search")) {
      const query = parsed.searchParams.get("query") || "";
      fetchImpl.searchUrls.push(url);
      fetchImpl.searchQueries.push(query);
      fetchImpl.cursorMarks.push(parsed.searchParams.get("cursorMark") || "");
      if (!/^GeneCopoeia AND FIRST_PDATE/.test(query)) {
        return ok({ hitCount: 0, resultList: { result: [] } });
      }
      const cursor = parsed.searchParams.get("cursorMark") || "*";
      if (cursor === "*") {
        return ok({
          hitCount: 3,
          nextCursorMark: "cursor-2",
          resultList: {
            result: [{
              pmid: "100001",
              pmcid: "PMC100001",
              title: "Supplier mention without nearby product",
              firstPublicationDate: "2025-01-01",
              authorString: "Curator One",
              abstractText: "Metadata summary."
            }]
          }
        });
      }
      if (cursor === "cursor-2") {
        return ok({
          hitCount: 3,
          nextCursorMark: "cursor-3",
          resultList: {
            result: [{
              pmid: "100002",
              pmcid: "PMC100002",
              title: "First exhaustive product use",
              firstPublicationDate: "2024-01-01",
              authorString: "Curator Two",
              abstractText: "Metadata summary."
            }]
          }
        });
      }
      if (cursor === "cursor-3") {
        return ok({
          hitCount: 5,
          nextCursorMark: "cursor-3",
          resultList: {
            result: [{
              pmid: "100003",
              pmcid: "PMC100003",
              title: "Second exhaustive product use",
              firstPublicationDate: "2023-01-01",
              authorString: "Curator Three",
              abstractText: "Metadata summary."
            }, {
              pmid: "100004",
              pmcid: "PMC100004",
              title: "Old catalog exhaustive product use",
              firstPublicationDate: "2022-01-01",
              authorString: "Curator Four",
              abstractText: "Metadata summary."
            }, {
              pmid: "100005",
              pmcid: "PMC100005",
              title: "Conflicting lenti catalog product use",
              firstPublicationDate: "2021-01-01",
              authorString: "Curator Five",
              abstractText: "Metadata summary."
            }]
          }
        });
      }
    }
    if (parsed.hostname === "www.ebi.ac.uk" && parsed.pathname.endsWith("/fullTextXML")) {
      fetchImpl.fullTextPaths.push(parsed.pathname);
      if (parsed.pathname.includes("PMC100001")) {
        return okText("<article><body><p>GeneCopoeia was listed as a supplier.</p><p>Cells were plated overnight.</p><p>The assay buffer was replaced.</p><p>Signals were normalized.</p><p>The BI001 catalog number appeared in a distant table.</p></body></article>");
      }
      if (parsed.pathname.includes("PMC100002")) {
        return okText("<article><body><p>The labeling reaction used GeneCopoeia BI001 biotin protein ligase for proximity labeling.</p></body></article>");
      }
      if (parsed.pathname.includes("PMC100003")) {
        return okText("<article><body><p>Cells were prepared with GeneCopoeia AA320 according to the supplier protocol.</p></body></article>");
      }
      if (parsed.pathname.includes("PMC100004")) {
        return okText("<article><body><p>AAV particles encoding eGFP were purchased from GeneCopoeia (catalog # AA002).</p></body></article>");
      }
      if (parsed.pathname.includes("PMC100005")) {
        return okText("<article><body><p>Lentivirus was produced using Lenti-Pac HIV expression packaging kit following the manufacturer's protocol (GeneCopoeia, LT002).</p></body></article>");
      }
    }
    return ok({});
  };
  fetchImpl.searchUrls = [];
  fetchImpl.searchQueries = [];
  fetchImpl.cursorMarks = [];
  fetchImpl.fullTextPaths = [];
  return fetchImpl;
}

function mockCrossrefCompanyCorpusFetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.crossref.org" && parsed.pathname.endsWith("/works")) {
      fetchImpl.filters.push(parsed.searchParams.get("filter"));
      return ok({
        message: {
          items: [{
            DOI: "10.5555/example",
            URL: "https://doi.org/10.5555/example",
            title: ["Conference abstract using a GeneCopoeia reagent"],
            abstract: "The methods used Lenti-Pac HIV Expression Packaging Kit supplied by GeneCopoeia LT001 for lentivirus production.",
            published: { "date-parts": [[2024, 3, 1]] },
            author: [{ given: "Curator", family: "Crossref" }]
          }]
        }
      });
    }
    return ok({});
  };
  fetchImpl.filters = [];
  return fetchImpl;
}

function mockBioRxivFetch() {
  let calls = 0;
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.biorxiv.org") {
      calls += 1;
      return ok({
        messages: [{ status: "ok", count: 2 }],
        collection: [
          {
            doi: "10.1101/2026.01.01.123456",
            title: "Genecopoeia biotin ligase candidate",
            authors: "Curator A; Curator B",
            author_corresponding_institution: "Example Institute",
            date: "2026-01-02",
            version: "1",
            category: "cell biology",
            abstract: "Methods used GeneCopoeia BI001 biotin protein ligase in the assay."
          },
          {
            doi: "10.1101/2026.01.03.999999",
            title: "Generic biotin ligase protocol",
            authors: "Curator C",
            date: "2026-01-03",
            version: "1",
            abstract: "This preprint discusses biotin protein ligase without a supplier."
          }
        ]
      });
    }
    return ok({});
  };
  fetchImpl.calls = () => calls;
  return fetchImpl;
}

function mockBioRxivExhaustiveFetch() {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.biorxiv.org") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const fromDate = parts[2];
      const toDate = parts[3];
      const cursor = parts[4];
      fetchImpl.cursors.push(cursor);
      fetchImpl.dateWindows.push({ fromDate, toDate });
      if (cursor === "0") {
        return ok({
          messages: [{ status: "ok", count: 3 }],
          collection: [
            {
              doi: "10.1101/2026.01.01.123456",
              title: "Recent Genecopoeia biotin ligase candidate",
              authors: "Curator A; Curator B",
              author_corresponding_institution: "Example Institute",
              date: "2026-01-02",
              version: "1",
              abstract: "Methods used GeneCopoeia BI001 biotin protein ligase in the assay."
            },
            {
              doi: "10.1101/2025.01.03.999999",
              title: "Generic biotin ligase protocol",
              authors: "Curator C",
              date: "2025-01-03",
              version: "1",
              abstract: "This preprint discusses biotin protein ligase without a supplier."
            }
          ]
        });
      }
      if (cursor === "2") {
        return ok({
          messages: [{ status: "ok", count: 3 }],
          collection: [{
            doi: "10.1101/2017.05.01.222222",
            title: "Older Genecopoeia product candidate",
            authors: "Curator D",
            author_corresponding_institution: "Older Institute",
            date: "2017-05-01",
            version: "2",
            abstract: "The methods used GeneCopoeia BI001 for proximity labeling."
          }]
        });
      }
      return ok({ messages: [{ status: "ok", count: 3 }], collection: [] });
    }
    return ok({});
  };
  fetchImpl.cursors = [];
  fetchImpl.dateWindows = [];
  return fetchImpl;
}

function mockEmptyFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esearch.fcgi")) {
      return ok({ esearchresult: { idlist: [] } });
    }
    return ok({});
  };
}

function memoryCompanyCorpusStore() {
  return {
    records: [],
    async listRecords() {
      return this.records;
    },
    async upsertRecords(records) {
      const byId = new Map(this.records.map((record) => [record.id, record]));
      for (const record of records) byId.set(record.id, record);
      this.records = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      return {
        saved: records.length,
        total: this.records.length,
        filePath: "memory://company-corpus.csv"
      };
    }
  };
}

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

function okText(text) {
  return {
    ok: true,
    status: 200,
    text: async () => text
  };
}
