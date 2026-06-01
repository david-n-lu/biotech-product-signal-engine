import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorScheduler } from "../src/platform/connectorScheduler.js";
import {
  buildBioRxivDetailsUrl,
  buildClinicalTrialsUrl,
  buildEuropePmcSearchUrl,
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
  assert.equal(new URL(buildEuropePmcSearchUrl("GeneCopoeia biotin protein ligase", 2)).hostname, "www.ebi.ac.uk");
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
});

test("Europe PMC query keeps Genecopoeia relationship while allowing full-text matches", () => {
  const url = new URL(buildEuropePmcSearchUrl("GeneCopoeia biotin protein ligase", 3));
  assert.equal(url.searchParams.get("query"), "GeneCopoeia AND \"biotin protein ligase\"");
  assert.equal(url.searchParams.get("resultType"), "core");
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

function mockEuropePmcFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.ebi.ac.uk") {
      return ok({
        hitCount: 1,
        resultList: {
          result: [{
            pmid: "321",
            pmcid: "PMC123456",
            title: "Genecopoeia biotin ligase candidate",
            firstPublicationDate: "2026-01-02",
            authorString: "Curator A, Curator B",
            abstractText: "Methods include GeneCopoeia biotin protein ligase.",
            citedByCount: 9
          }]
        }
      });
    }
    return ok({});
  };
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

function mockEmptyFetch() {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.pathname.endsWith("/esearch.fcgi")) {
      return ok({ esearchresult: { idlist: [] } });
    }
    return ok({});
  };
}

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}
