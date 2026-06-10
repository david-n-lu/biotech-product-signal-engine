const NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CLINICAL_TRIALS = "https://clinicaltrials.gov/api/v2/studies";
const NIH_REPORTER = "https://api.reporter.nih.gov/v2/projects/search";
const PATENTSVIEW = "https://api.patentsview.org/patents/query";
const EUROPE_PMC_REST = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const EUROPE_PMC_SEARCH = `${EUROPE_PMC_REST}/search`;
const BIORXIV_DETAILS = "https://api.biorxiv.org/details/biorxiv";
const CROSSREF_WORKS = "https://api.crossref.org/v1/works";
const OPENALEX_WORKS = "https://api.openalex.org/works";

export const PUBLICATION_CONNECTOR_IDS = [
  "pubmed_publications",
  "europepmc_fulltext_publications",
  "biorxiv_preprints",
  "crossref_conferences"
];

const SEARCH_MODE_CONFIG = {
  standard: {
    queryLimit: 2,
    perQueryLimit: undefined,
    pubMedPages: 1,
    europePmcExhaustive: false
  },
  deep: {
    queryLimit: 8,
    perQueryLimit: 10,
    pubMedPages: 3,
    europePmcExhaustive: false
  },
  exhaustive10y: {
    queryLimit: 8,
    perQueryLimit: 1000,
    pubMedPages: 3,
    pubMedYears: 10,
    pubMedMaxPages: 1000,
    europePmcExhaustive: true,
    europePmcCompanySweep: true,
    europePmcFullTextOnly: false,
    europePmcYears: 10,
    europePmcMaxPages: 10000,
    bioRxivYears: 10,
    bioRxivMaxPages: 10000,
    crossrefYears: 10,
    crossrefMaxPages: 1000
  }
};

export const CONNECTOR_DEFINITIONS = [
  {
    id: "pubmed_publications",
    name: "PubMed publications",
    sourceType: "publication",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.28,
    description: "Searches NCBI E-utilities for Genecopoeia-qualified product, catalog, RRID, and synonym mentions."
  },
  {
    id: "europepmc_fulltext_publications",
    name: "Europe PMC full-text publications",
    sourceType: "publication",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.3,
    documentationUrl: "https://europepmc.org/RestfulWebService",
    description: "Searches Europe PMC metadata and full text for Genecopoeia-qualified product-use mentions that PubMed abstracts can miss."
  },
  {
    id: "biorxiv_preprints",
    name: "bioRxiv preprints",
    sourceType: "publication",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.24,
    documentationUrl: "https://api.biorxiv.org/",
    description: "Searches recent bioRxiv preprint metadata and abstracts for Genecopoeia-qualified product-use mentions."
  },
  {
    id: "patentsview_patents",
    name: "USPTO / PatentsView patents",
    sourceType: "patent",
    defaultEnabled: false,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.24,
    requiresConfiguration: true,
    description: "Patent search is disabled until a USPTO Open Data Portal key or replacement patent endpoint is configured; the legacy PatentsView endpoint now returns an HTML transition page."
  },
  {
    id: "clinicaltrials_trials",
    name: "ClinicalTrials.gov trials",
    sourceType: "trial",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.25,
    description: "Searches ClinicalTrials.gov v2 study records for reagent mentions."
  },
  {
    id: "nih_reporter_grants",
    name: "NIH RePORTER grants",
    sourceType: "grant",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.25,
    description: "Searches NIH RePORTER project title, terms, and abstract text."
  },
  {
    id: "openalex_protocols",
    name: "OpenAlex protocols",
    sourceType: "protocol",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.22,
    description: "Searches OpenAlex works with protocol-oriented query terms."
  },
  {
    id: "crossref_conferences",
    name: "Crossref conference abstracts",
    sourceType: "conference_abstract",
    defaultEnabled: true,
    defaultIntervalMinutes: 1440,
    defaultConfidence: 0.22,
    description: "Searches Crossref proceedings metadata for conference-style mentions."
  },
  {
    id: "custom_social_mentions",
    name: "Custom social mentions",
    sourceType: "social_mention",
    defaultEnabled: false,
    defaultIntervalMinutes: 360,
    defaultConfidence: 0.18,
    description: "Optional authenticated/social-listening endpoint. Disabled until a JSON endpoint is configured."
  }
];

export function createConnectorConfigs(overrides = []) {
  const byId = new Map(overrides.map((item) => [item.id, item]));
  return CONNECTOR_DEFINITIONS.map((definition) => {
    const override = byId.get(definition.id) || {};
    return {
      id: definition.id,
      name: definition.name,
      sourceType: definition.sourceType,
      description: definition.description,
      enabled: override.enabled ?? definition.defaultEnabled,
      intervalMinutes: override.intervalMinutes || definition.defaultIntervalMinutes,
      defaultConfidence: definition.defaultConfidence,
      endpointUrl: override.endpointUrl || "",
      documentationUrl: override.documentationUrl || definition.documentationUrl || "",
      lastRunAt: override.lastRunAt || "",
      nextRunAt: override.nextRunAt || "",
      lastStatus: override.lastStatus || "never_run",
      lastImported: override.lastImported || 0,
      lastErrors: override.lastErrors || [],
      lastNotices: override.lastNotices || [],
      requiresConfiguration: definition.requiresConfiguration || false
    };
  });
}

export async function runSourceConnector({ connector, products, fetchImpl = globalThis.fetch, now = new Date(), perProductLimit, searchMode = "standard" }) {
  if (!connector.enabled) {
    return {
      connectorId: connector.id,
      importedCandidates: [],
      errors: [`${connector.name} is disabled.`]
    };
  }
  if (typeof fetchImpl !== "function") {
    return {
      connectorId: connector.id,
      importedCandidates: [],
      errors: ["Connector runs require a runtime with fetch support."]
    };
  }

  const importedCandidates = [];
  const errors = [];
  const notices = [];
  const selectedProducts = products.filter(Boolean);
  const runContext = { cache: new Map(), corpusRecords: [] };
  const searchOptions = connectorSearchOptions(searchMode, perProductLimit);

  if (connector.id === "pubmed_publications" && isExhaustivePublicationSearch(searchOptions)) {
    try {
      importedCandidates.push(...await searchPubMedCompanySweep(connector, selectedProducts, fetchImpl, searchOptions.perQueryLimit, now, runContext, searchOptions));
    } catch (error) {
      errors.push(`${connector.name} failed for company-wide Genecopoeia search: ${error.message}`);
    }
    addNoHitNotices(notices, connector, selectedProducts, importedCandidates, errors);
    return {
      connectorId: connector.id,
      importedCandidates: dedupeCandidates(importedCandidates),
      corpusRecords: dedupeCandidates(runContext.corpusRecords || []),
      errors,
      notices
    };
  }

  if (connector.id === "europepmc_fulltext_publications" && searchOptions.europePmcCompanySweep) {
    try {
      importedCandidates.push(...await searchEuropePmcCompanySweep(connector, selectedProducts, fetchImpl, searchOptions.perQueryLimit, now, runContext, searchOptions));
    } catch (error) {
      errors.push(`${connector.name} failed for company-wide Genecopoeia search: ${error.message}`);
    }
    addNoHitNotices(notices, connector, selectedProducts, importedCandidates, errors);
    return {
      connectorId: connector.id,
      importedCandidates: dedupeCandidates(importedCandidates),
      corpusRecords: dedupeCandidates(runContext.corpusRecords || []),
      errors,
      notices
    };
  }

  if (connector.id === "biorxiv_preprints" && isExhaustivePublicationSearch(searchOptions)) {
    try {
      importedCandidates.push(...await searchBioRxivCompanySweep(connector, selectedProducts, fetchImpl, searchOptions.perQueryLimit, now, runContext, searchOptions));
    } catch (error) {
      errors.push(`${connector.name} failed for company-wide Genecopoeia search: ${error.message}`);
    }
    addNoHitNotices(notices, connector, selectedProducts, importedCandidates, errors);
    return {
      connectorId: connector.id,
      importedCandidates: dedupeCandidates(importedCandidates),
      corpusRecords: dedupeCandidates(runContext.corpusRecords || []),
      errors,
      notices
    };
  }

  if (connector.id === "crossref_conferences" && isExhaustivePublicationSearch(searchOptions)) {
    try {
      importedCandidates.push(...await searchCrossrefCompanySweep(connector, selectedProducts, fetchImpl, searchOptions.perQueryLimit, now, runContext, searchOptions));
    } catch (error) {
      errors.push(`${connector.name} failed for company-wide Genecopoeia search: ${error.message}`);
    }
    addNoHitNotices(notices, connector, selectedProducts, importedCandidates, errors);
    return {
      connectorId: connector.id,
      importedCandidates: dedupeCandidates(importedCandidates),
      corpusRecords: dedupeCandidates(runContext.corpusRecords || []),
      errors,
      notices
    };
  }

  for (const product of selectedProducts) {
    const queries = buildProductQueries(product, { searchMode }).slice(0, searchOptions.queryLimit);
    const before = importedCandidates.length;
    for (const query of queries) {
      try {
        const hits = await searchConnector(connector, product, query, fetchImpl, searchOptions.perQueryLimit, now, runContext, searchOptions);
        importedCandidates.push(...hits);
      } catch (error) {
        errors.push(`${connector.name} failed for ${product.productName}: ${error.message}`);
      }
    }
    if (importedCandidates.length === before && errors.length === 0) {
      notices.push(`${connector.name} found no Genecopoeia-qualified hits for ${product.productName}.`);
    }
  }

  return {
    connectorId: connector.id,
    importedCandidates: dedupeCandidates(importedCandidates),
    corpusRecords: dedupeCandidates(runContext.corpusRecords || []),
    errors,
    notices
  };
}

export async function runSourceConnectors({ connectors, products, connectorIds = [], fetchImpl = globalThis.fetch, now = new Date(), perProductLimit, searchMode = "standard" }) {
  const requested = connectorIds.length
    ? connectors.filter((connector) => connectorIds.includes(connector.id))
    : connectors.filter((connector) => connector.enabled);
  const runs = [];
  const records = [];
  const corpusRecords = [];
  const errors = [];
  const notices = [];

  for (const connector of requested) {
    const result = await runSourceConnector({ connector, products, fetchImpl, now, perProductLimit, searchMode });
    runs.push({
      connectorId: connector.id,
      imported: result.importedCandidates.length,
      errors: result.errors,
      notices: result.notices || []
    });
    records.push(...result.importedCandidates);
    corpusRecords.push(...(result.corpusRecords || []));
    errors.push(...result.errors);
    notices.push(...(result.notices || []));
  }

  return {
    records: dedupeCandidates(records),
    corpusRecords: dedupeCandidates(corpusRecords),
    errors,
    notices,
    runs
  };
}

export function buildProductQueries(product, options = {}) {
  const company = clean(product.company) || "GeneCopoeia";
  const searchMode = options.searchMode || "standard";
  const identifiers = [product.catalogNumber, product.rrid].map(clean).filter(Boolean);
  const expanded = isExpandedPublicationSearch(searchMode);
  const names = [
    product.productName,
    ...(product.synonyms || []).slice(0, expanded ? 6 : 2)
  ].map(clean).filter(Boolean);
  const identityTerms = expanded
    ? [...identifiers, ...names.flatMap(queryVariants)]
    : [...identifiers, ...names];
  const companyTerms = expanded ? companyVariants(company) : [company];
  const companyQualified = identityTerms.flatMap((value) => companyTerms.map((companyTerm) => `${companyTerm} ${value}`))
    .filter(Boolean);

  return unique(companyQualified.length ? companyQualified : identityTerms);
}

function connectorSearchOptions(searchMode = "standard", perProductLimit) {
  const normalizedMode = SEARCH_MODE_CONFIG[searchMode] ? searchMode : "standard";
  const config = SEARCH_MODE_CONFIG[normalizedMode];
  const requestedLimit = Number.parseInt(String(perProductLimit ?? ""), 10);
  const fallbackLimit = config.perQueryLimit ?? 2;
  return {
    searchMode: normalizedMode,
    queryLimit: config.queryLimit,
    perQueryLimit: requestedLimit > 0 ? clampLimitForMode(requestedLimit, normalizedMode) : clampLimitForMode(fallbackLimit, normalizedMode),
    pubMedPages: Math.max(1, Number.parseInt(String(config.pubMedPages || 1), 10) || 1),
    pubMedYears: Math.max(1, Number.parseInt(String(config.pubMedYears || 1), 10) || 1),
    pubMedMaxPages: Math.max(1, Number.parseInt(String(config.pubMedMaxPages || 1), 10) || 1),
    europePmcExhaustive: Boolean(config.europePmcExhaustive),
    europePmcCompanySweep: Boolean(config.europePmcCompanySweep),
    europePmcFullTextOnly: config.europePmcFullTextOnly ?? Boolean(config.europePmcExhaustive),
    europePmcYears: Math.max(1, Number.parseInt(String(config.europePmcYears || 0), 10) || 0),
    europePmcMaxPages: Math.max(1, Number.parseInt(String(config.europePmcMaxPages || 1), 10) || 1),
    bioRxivYears: Math.max(1, Number.parseInt(String(config.bioRxivYears || 1), 10) || 1),
    bioRxivMaxPages: Math.max(1, Number.parseInt(String(config.bioRxivMaxPages || 1), 10) || 1),
    crossrefYears: Math.max(1, Number.parseInt(String(config.crossrefYears || 1), 10) || 1),
    crossrefMaxPages: Math.max(1, Number.parseInt(String(config.crossrefMaxPages || 1), 10) || 1)
  };
}

function isExpandedPublicationSearch(searchMode) {
  return searchMode === "deep" || searchMode === "exhaustive10y";
}

function isExhaustivePublicationSearch(searchOptions = {}) {
  return searchOptions.searchMode === "exhaustive10y";
}

function addNoHitNotices(notices, connector, selectedProducts, importedCandidates, errors) {
  if (errors.length || !selectedProducts.length) return;
  const matchedProductIds = new Set(importedCandidates.map((record) => record.productId).filter(Boolean));
  for (const product of selectedProducts) {
    if (!matchedProductIds.has(product.id)) {
      notices.push(`${connector.name} found no Genecopoeia-qualified hits for ${product.productName}.`);
    }
  }
}

function queryVariants(value) {
  const original = normalizeWhitespace(value);
  const withoutMarks = normalizeWhitespace(removeTrademarkSymbols(original));
  const compactMarks = normalizeWhitespace(String(original || "").replace(/[\u00a9\u00ae\u2122]/g, ""));
  const spacedCamelCase = normalizeWhitespace(withoutMarks.replace(/([a-z])([A-Z])/g, "$1 $2"));
  const asciiFolded = normalizeWhitespace(withoutMarks.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""));
  return unique([original, withoutMarks, compactMarks, spacedCamelCase, asciiFolded]);
}

function companyVariants(company) {
  const value = normalizeWhitespace(company);
  const compact = value.replace(/\s+/g, "");
  if (/^genecopoeia$/i.test(compact)) return ["GeneCopoeia", "Gene Copoeia"];
  return unique([value, normalizeWhitespace(removeTrademarkSymbols(value))]);
}

function removeTrademarkSymbols(value) {
  return String(value || "").replace(/[\u00a9\u00ae\u2122]/g, " ");
}

function normalizeWhitespace(value) {
  return clean(String(value || "").replace(/\s+/g, " "));
}

export function buildPubMedSearchUrl(query, limit, retstart = 0, options = {}) {
  const url = new URL(`${NCBI_EUTILS}/esearch.fcgi`);
  const params = {
    db: "pubmed",
    term: buildPubMedTerm(query, options.searchMode),
    retmode: "json",
    retmax: String(clampLimitForMode(limit, options.searchMode)),
    retstart: String(Math.max(0, Number.parseInt(String(retstart || 0), 10) || 0)),
    sort: "pub date"
  };
  if (options.startDate && options.endDate) {
    params.datetype = "pdat";
    params.mindate = options.startDate;
    params.maxdate = options.endDate;
  }
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

export function buildPubMedSummaryUrl(ids) {
  const url = new URL(`${NCBI_EUTILS}/esummary.fcgi`);
  url.search = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json"
  }).toString();
  return url.toString();
}

export function buildPubMedFetchUrl(ids) {
  const url = new URL(`${NCBI_EUTILS}/efetch.fcgi`);
  url.search = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "xml"
  }).toString();
  return url.toString();
}

export function buildEuropePmcSearchUrl(query, limit, options = {}) {
  const url = new URL(EUROPE_PMC_SEARCH);
  const searchQuery = buildEuropePmcQuery(query, options);
  const params = {
    query: searchQuery,
    format: "json",
    pageSize: String(clampEuropePmcPageSize(limit)),
    resultType: "core",
    sort: "FIRST_PDATE_D desc"
  };
  if (options.cursorMark) params.cursorMark = options.cursorMark;
  url.search = new URLSearchParams({
    ...params
  }).toString();
  return url.toString();
}

function buildEuropePmcQuery(query, options = {}) {
  const filters = [];
  if (options.fullTextOnly) filters.push("HAS_FT:y");
  if (options.startDate && options.endDate) {
    filters.push(`FIRST_PDATE:[${options.startDate} TO ${options.endDate}]`);
  }
  return [buildBooleanQuery(query), ...filters].filter(Boolean).join(" AND ");
}

export function buildEuropePmcFullTextXmlUrl(sourceOrPmcid, id = "") {
  const candidate = /^PMC$/i.test(clean(sourceOrPmcid)) && id ? id : sourceOrPmcid;
  return `${EUROPE_PMC_REST}/${encodeURIComponent(normalizePmcid(candidate))}/fullTextXML`;
}

export function buildBioRxivDetailsUrl(fromDate, toDate, cursor = 0) {
  return `${BIORXIV_DETAILS}/${encodeURIComponent(fromDate)}/${encodeURIComponent(toDate)}/${encodeURIComponent(String(cursor))}/json`;
}

export function buildClinicalTrialsUrl(query, limit) {
  const url = new URL(CLINICAL_TRIALS);
  url.search = new URLSearchParams({
    "query.term": query,
    pageSize: String(clampLimit(limit)),
    format: "json"
  }).toString();
  return url.toString();
}

export function buildPatentsViewUrl(query, limit) {
  const url = new URL(PATENTSVIEW);
  url.search = new URLSearchParams({
    q: JSON.stringify(buildPatentsViewQuery(query)),
    f: JSON.stringify(["patent_id", "patent_title", "patent_abstract", "patent_date", "assignees.assignee_organization"]),
    o: JSON.stringify({ per_page: clampLimit(limit) })
  }).toString();
  return url.toString();
}

export function buildCrossrefConferenceUrl(query, limit, options = {}) {
  const url = new URL(CROSSREF_WORKS);
  const filters = ["type:proceedings-article"];
  if (options.startDate) filters.push(`from-pub-date:${options.startDate}`);
  if (options.endDate) filters.push(`until-pub-date:${options.endDate}`);
  url.search = new URLSearchParams({
    "query.bibliographic": quotePhrase(query),
    filter: filters.join(","),
    rows: String(clampLimitForMode(limit, options.searchMode)),
    offset: String(Math.max(0, Number.parseInt(String(options.offset || 0), 10) || 0)),
    sort: "published",
    order: "desc"
  }).toString();
  return url.toString();
}

export function buildOpenAlexProtocolUrl(query, limit) {
  const url = new URL(OPENALEX_WORKS);
  url.search = new URLSearchParams({
    search: `${quotePhrase(query)} protocol methods`,
    per_page: String(clampLimit(limit)),
    sort: "publication_date:desc"
  }).toString();
  return url.toString();
}

export function buildReporterRequest(query, limit) {
  return {
    criteria: {
      advanced_text_search: {
        operator: "and",
        search_field: "projecttitle,terms,abstracttext",
        search_text: quotePhrase(query)
      }
    },
    offset: 0,
    limit: clampLimit(limit),
    sort_field: "award_notice_date",
    sort_order: "desc"
  };
}

async function searchConnector(connector, product, query, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  if (connector.id === "pubmed_publications") return searchPubMed(connector, product, query, fetchImpl, limit, now, searchOptions);
  if (connector.id === "europepmc_fulltext_publications") return searchEuropePmc(connector, product, query, fetchImpl, limit, now, context, searchOptions);
  if (connector.id === "biorxiv_preprints") return searchBioRxiv(connector, product, query, fetchImpl, limit, now, context, searchOptions);
  if (connector.id === "patentsview_patents") return searchPatents(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "clinicaltrials_trials") return searchClinicalTrials(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "nih_reporter_grants") return searchReporter(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "openalex_protocols") return searchOpenAlexProtocols(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "crossref_conferences") return searchCrossrefConferences(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "custom_social_mentions") return searchCustomSocial(connector, product, query, fetchImpl, limit, now);
  return [];
}

async function searchPubMed(connector, product, query, fetchImpl, limit, now, searchOptions = connectorSearchOptions()) {
  const ids = [];
  const pageLimit = clampLimit(limit);
  const pages = Math.max(1, Number.parseInt(String(searchOptions.pubMedPages || 1), 10) || 1);
  for (let page = 0; page < pages; page += 1) {
    const search = await fetchJson(fetchImpl, buildPubMedSearchUrl(query, pageLimit, page * pageLimit, searchOptions));
    const pageIds = search.esearchresult?.idlist || [];
    ids.push(...pageIds);
    if (pageIds.length < pageLimit) break;
  }
  const uniqueIds = unique(ids);
  if (uniqueIds.length === 0) return [];
  const summary = await fetchJson(fetchImpl, buildPubMedSummaryUrl(uniqueIds));
  return (summary.result?.uids || uniqueIds).map((uid) => {
    const item = summary.result?.[uid] || {};
    const title = clean(item.title) || `PubMed record ${uid}`;
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `PubMed: ${title}`,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      sourceId: String(uid),
      date: normalizeDate(item.pubdate),
      authors: formatPubMedAuthors(item.authors),
      snippet: `PubMed metadata matched ${query}: ${title}. Review the article before treating this candidate as curated product-use evidence.`,
      impactScore: undefined
    });
  });
}

async function searchPubMedCompanySweep(connector, products, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const idsByQuery = new Map();
  const pageLimit = clampLimitForMode(limit, searchOptions.searchMode);
  const pages = Math.max(1, Number.parseInt(String(searchOptions.pubMedMaxPages || 1), 10) || 1);
  for (const query of companySweepQueries(products)) {
    for (let page = 0; page < pages; page += 1) {
      const retstart = page * pageLimit;
      const data = await fetchJson(fetchImpl, buildPubMedSearchUrl(query, pageLimit, retstart, {
        ...searchOptions,
        startDate: yearsAgoDate(now, searchOptions.pubMedYears),
        endDate: toIsoDate(now)
      }));
      const pageIds = data.esearchresult?.idlist || [];
      for (const id of pageIds) {
        if (!idsByQuery.has(id)) idsByQuery.set(id, query);
      }
      if (pageIds.length < pageLimit) break;
    }
  }

  const ids = [...idsByQuery.keys()];
  if (!ids.length) return [];
  const summary = await fetchJson(fetchImpl, buildPubMedSummaryUrl(ids));
  const articleTexts = await fetchPubMedArticleTexts(ids, fetchImpl, context);
  const records = [];

  for (const uid of summary.result?.uids || ids) {
    const item = summary.result?.[uid] || {};
    const query = idsByQuery.get(String(uid)) || "GeneCopoeia";
    const title = clean(item.title) || articleTexts.get(String(uid))?.title || `PubMed record ${uid}`;
    const articleText = articleTexts.get(String(uid))?.text || "";
    const metadataText = [title, articleText].filter(Boolean).join(" ");
    const companyContexts = nearbyCompanyContexts(metadataText, products);
    const contexts = companyContexts.length
      ? companyContexts
      : fallbackCompanyCorpusContexts(metadataText, query);

    for (const companyContext of contexts) {
      context.corpusRecords?.push(sourceCorpusCandidate({
        connector,
        query,
        now,
        sourceName: "PubMed",
        sourceTitle: `PubMed: ${title}`,
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        sourceId: String(uid),
        date: normalizeDate(item.pubdate),
        authors: formatPubMedAuthors(item.authors),
        institution: "",
        contextText: companyContext,
        searchOptions,
        sourceCorpus: "local_pubmed_10y"
      }));
    }

    for (const product of products || []) {
      const evidenceContext = productContextFromCompanyContexts(companyContexts, product);
      if (!evidenceContext) continue;
      records.push(candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `PubMed: ${title}`,
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        sourceId: String(uid),
        date: normalizeDate(item.pubdate),
        authors: formatPubMedAuthors(item.authors),
        snippet: trimSnippet([
          `PubMed company-wide context matched ${evidenceContext.matchedTerms.join(", ")} near GeneCopoeia.`,
          evidenceContext.text
        ].filter(Boolean).join(" ")),
        europePmcSentences: evidenceContext.text,
        rawPayload: publicationCorpusRunPayload(searchOptions, now, "PubMed", "local_pubmed_10y"),
        impactScore: undefined
      }));
    }
  }

  return records;
}

async function searchEuropePmc(connector, product, query, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const pages = searchOptions.europePmcExhaustive
    ? await fetchAllEuropePmcSearchPages(query, limit, fetchImpl, now, searchOptions)
    : [await fetchJson(fetchImpl, buildEuropePmcSearchUrl(query, limit))];
  const records = [];
  for (const data of pages) {
    for (const item of data.resultList?.result || []) {
      const sourceId = clean(item.pmid || item.pmcid || item.doi || item.id);
      const title = clean(item.title) || `Europe PMC record ${sourceId}`;
      const fullText = await fetchEuropePmcFullText(item, fetchImpl, context);
      const evidenceContext = nearbyCompanyProductContext(fullText, product)
        || nearbyCompanyProductContext([item.abstractText, title].filter(Boolean).join(" "), product);
      if (!evidenceContext) continue;

      records.push(candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `Europe PMC: ${title}`,
        sourceUrl: europePmcUrl(item),
        sourceId,
        date: normalizeDate(item.firstPublicationDate || item.firstIndexDate || item.pubYear),
        authors: splitAuthors(item.authorString),
        institution: clean(item.affiliation),
        snippet: trimSnippet([
          `Europe PMC nearby context matched ${evidenceContext.matchedTerms.join(", ")} within two sentences of GeneCopoeia.`,
          evidenceContext.text
        ].filter(Boolean).join(" ")),
        europePmcSentences: evidenceContext.text,
        rawPayload: europePmcRunPayload(searchOptions, now),
        impactScore: Number(item.citedByCount || 0) ? Math.min(10, Math.log10(Number(item.citedByCount) + 1) * 3) : undefined
      }));
    }
  }
  return records;
}

async function searchEuropePmcCompanySweep(connector, products, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const itemsByKey = new Map();
  for (const query of europePmcCompanySweepQueries(products)) {
    const pages = await fetchAllEuropePmcSearchPages(query, limit, fetchImpl, now, searchOptions);
    for (const data of pages) {
      for (const item of data.resultList?.result || []) {
        const key = europePmcRecordKey(item);
        if (!itemsByKey.has(key)) itemsByKey.set(key, { item, query });
      }
    }
  }

  const records = [];
  for (const { item, query } of itemsByKey.values()) {
    const sourceId = clean(item.pmid || item.pmcid || item.doi || item.id);
    const title = clean(item.title) || `Europe PMC record ${sourceId}`;
    const fullText = await fetchEuropePmcFullText(item, fetchImpl, context);
    const contexts = nearbyCompanyContexts(fullText, products);
    const fallbackContexts = contexts.length
      ? []
      : nearbyCompanyContexts([item.abstractText, title].filter(Boolean).join(" "), products);
    const companyContexts = contexts.length ? contexts : fallbackContexts;

    for (const companyContext of companyContexts) {
      context.corpusRecords?.push(companyCorpusCandidate({
        connector,
        query,
        now,
        item,
        title,
        sourceId,
        companyContext,
        searchOptions
      }));
    }

    for (const product of products) {
      const evidenceContext = productContextFromCompanyContexts(contexts, product)
        || productContextFromCompanyContexts(fallbackContexts, product);
      if (!evidenceContext) continue;

      records.push(candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `Europe PMC: ${title}`,
        sourceUrl: europePmcUrl(item),
        sourceId,
        date: normalizeDate(item.firstPublicationDate || item.firstIndexDate || item.pubYear),
        authors: splitAuthors(item.authorString),
        institution: clean(item.affiliation),
        snippet: trimSnippet([
          `Europe PMC company-wide context matched ${evidenceContext.matchedTerms.join(", ")} within two sentences of GeneCopoeia.`,
          evidenceContext.text
        ].filter(Boolean).join(" ")),
        europePmcSentences: evidenceContext.text,
        rawPayload: {
          ...europePmcRunPayload(searchOptions, now),
          searchStrategy: "company_first_10y"
        },
        impactScore: Number(item.citedByCount || 0) ? Math.min(10, Math.log10(Number(item.citedByCount) + 1) * 3) : undefined
      }));
    }
  }

  return records;
}

async function fetchAllEuropePmcSearchPages(query, limit, fetchImpl, now, searchOptions) {
  const pages = [];
  const pageSize = clampEuropePmcPageSize(limit);
  let cursorMark = "*";
  for (let page = 0; page < searchOptions.europePmcMaxPages; page += 1) {
    const data = await fetchJson(fetchImpl, buildEuropePmcSearchUrl(query, pageSize, {
      cursorMark,
      fullTextOnly: searchOptions.europePmcFullTextOnly,
      startDate: yearsAgoDate(now, searchOptions.europePmcYears),
      endDate: toIsoDate(now)
    }));
    pages.push(data);
    const results = data.resultList?.result || [];
    const nextCursorMark = clean(data.nextCursorMark);
    if (!results.length || !nextCursorMark || nextCursorMark === cursorMark) break;
    cursorMark = nextCursorMark;
  }
  return pages;
}

function europePmcCompanySweepQueries(products = []) {
  return companySweepQueries(products);
}

function companySweepQueries(products = []) {
  return unique((products.length ? products : [{ company: "GeneCopoeia" }])
    .flatMap((product) => companyVariants(clean(product.company) || "GeneCopoeia")));
}

function europePmcRecordKey(item) {
  return clean(item.pmid || item.pmcid || item.doi || item.id || item.sourceUrl || item.title);
}

function crossrefRecordKey(item) {
  return clean(item.DOI || item.URL || (Array.isArray(item.title) ? item.title[0] : item.title));
}

function europePmcRunPayload(searchOptions, now) {
  if (!searchOptions.europePmcExhaustive) return {};
  return {
    searchMode: searchOptions.searchMode,
    searchWindow: {
      source: "Europe PMC",
      startDate: yearsAgoDate(now, searchOptions.europePmcYears),
      endDate: toIsoDate(now),
      fullTextOnly: Boolean(searchOptions.europePmcFullTextOnly),
      pageSize: searchOptions.perQueryLimit
    }
  };
}

function publicationCorpusRunPayload(searchOptions, now, source, sourceCorpus) {
  if (searchOptions.searchMode !== "exhaustive10y") return {};
  const yearsBySource = {
    PubMed: searchOptions.pubMedYears,
    "bioRxiv": searchOptions.bioRxivYears,
    Crossref: searchOptions.crossrefYears
  };
  return {
    searchMode: searchOptions.searchMode,
    sourceCorpus,
    searchWindow: {
      source,
      startDate: yearsAgoDate(now, yearsBySource[source] || 10),
      endDate: toIsoDate(now),
      pageSize: searchOptions.perQueryLimit
    }
  };
}

async function searchBioRxiv(connector, product, query, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const pages = await fetchBioRxivPages(fetchImpl, now, context, searchOptions);
  return pages.flatMap((data) => data.collection || [])
    .filter((item) => matchesAllQueryTerms(bioRxivSearchText(item), query))
    .slice(0, searchOptions.searchMode === "exhaustive10y" ? clampEuropePmcPageSize(limit) : clampLimit(limit))
    .map((item) => {
      const sourceId = bioRxivSourceId(item);
      const title = clean(item.title) || `bioRxiv preprint ${sourceId}`;
      return candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `bioRxiv: ${title}`,
        sourceUrl: bioRxivUrl(item),
        sourceId,
        date: normalizeDate(item.date),
        authors: splitAuthors(item.authors),
        institution: clean(item.author_corresponding_institution),
        snippet: trimSnippet([
          `bioRxiv metadata matched ${query} after local Genecopoeia/product filtering.`,
          title,
          clean(item.abstract)
        ].filter(Boolean).join(" ")),
        rawPayload: bioRxivRunPayload(searchOptions, now),
        impactScore: undefined
      });
    });
}

async function searchBioRxivCompanySweep(connector, products, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const pages = await fetchBioRxivPages(fetchImpl, now, context, searchOptions);
  const records = [];
  for (const item of pages.flatMap((data) => data.collection || [])) {
    const text = bioRxivSearchText(item);
    if (!companyContextTerms(products).some((term) => containsNormalizedTerm(text, term))) continue;
    const query = "GeneCopoeia";
    const sourceId = bioRxivSourceId(item);
    const title = clean(item.title) || `bioRxiv preprint ${sourceId}`;
    const companyContexts = nearbyCompanyContexts(text, products);
    const contexts = companyContexts.length
      ? companyContexts
      : fallbackCompanyCorpusContexts(text, query);

    for (const companyContext of contexts) {
      context.corpusRecords?.push(sourceCorpusCandidate({
        connector,
        query,
        now,
        sourceName: "bioRxiv",
        sourceTitle: `bioRxiv: ${title}`,
        sourceUrl: bioRxivUrl(item),
        sourceId,
        date: normalizeDate(item.date),
        authors: splitAuthors(item.authors),
        institution: clean(item.author_corresponding_institution),
        contextText: companyContext,
        searchOptions,
        sourceCorpus: "local_biorxiv_10y"
      }));
    }

    for (const product of products || []) {
      const evidenceContext = productContextFromCompanyContexts(companyContexts, product);
      if (!evidenceContext) continue;
      records.push(candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `bioRxiv: ${title}`,
        sourceUrl: bioRxivUrl(item),
        sourceId,
        date: normalizeDate(item.date),
        authors: splitAuthors(item.authors),
        institution: clean(item.author_corresponding_institution),
        snippet: trimSnippet([
          `bioRxiv company-wide context matched ${evidenceContext.matchedTerms.join(", ")} near GeneCopoeia.`,
          evidenceContext.text
        ].filter(Boolean).join(" ")),
        europePmcSentences: evidenceContext.text,
        rawPayload: publicationCorpusRunPayload(searchOptions, now, "bioRxiv", "local_biorxiv_10y"),
        impactScore: undefined
      }));
    }
  }
  return records;
}

async function fetchBioRxivPages(fetchImpl, now, context = {}, searchOptions = connectorSearchOptions()) {
  const toDate = toIsoDate(now);
  const fromDate = searchOptions.searchMode === "exhaustive10y"
    ? yearsAgoDate(now, searchOptions.bioRxivYears)
    : toIsoDate(addDays(now, -365));
  const pages = [];
  let cursor = 0;
  for (let page = 0; page < searchOptions.bioRxivMaxPages; page += 1) {
    const url = buildBioRxivDetailsUrl(fromDate, toDate, cursor);
    const cacheKey = `biorxiv:${url}`;
    const data = context.cache?.get(cacheKey) || await fetchJson(fetchImpl, url);
    context.cache?.set(cacheKey, data);
    pages.push(data);
    const collection = data.collection || [];
    if (searchOptions.searchMode !== "exhaustive10y" || collection.length === 0) break;
    cursor += collection.length;
  }
  return pages;
}

function bioRxivRunPayload(searchOptions, now) {
  if (searchOptions.searchMode !== "exhaustive10y") return {};
  return {
    searchMode: searchOptions.searchMode,
    searchWindow: {
      source: "bioRxiv",
      startDate: yearsAgoDate(now, searchOptions.bioRxivYears),
      endDate: toIsoDate(now),
      pageSize: searchOptions.perQueryLimit
    }
  };
}

async function searchClinicalTrials(connector, product, query, fetchImpl, limit, now) {
  const data = await fetchJson(fetchImpl, buildClinicalTrialsUrl(query, limit));
  return (data.studies || []).map((study) => {
    const protocol = study.protocolSection || {};
    const identification = protocol.identificationModule || {};
    const status = protocol.statusModule || {};
    const sponsor = protocol.sponsorCollaboratorsModule || {};
    const description = protocol.descriptionModule || {};
    const nctId = clean(identification.nctId);
    const title = clean(identification.briefTitle || identification.officialTitle) || `ClinicalTrials.gov study ${nctId}`;
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `ClinicalTrials.gov: ${title}`,
      sourceUrl: nctId ? `https://clinicaltrials.gov/study/${nctId}` : "https://clinicaltrials.gov/",
      sourceId: nctId,
      date: normalizeDate(status.studyFirstSubmitDate || status.startDateStruct?.date),
      authors: [],
      institution: clean(sponsor.leadSponsor?.name),
      snippet: trimSnippet(`${title}. ${description.briefSummary || ""}`) || `ClinicalTrials.gov metadata matched ${query}.`,
      impactScore: undefined
    });
  });
}

async function searchReporter(connector, product, query, fetchImpl, limit, now) {
  const data = await fetchJson(fetchImpl, NIH_REPORTER, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(buildReporterRequest(query, limit))
  });
  return (data.results || []).map((grant) => {
    const projectNumber = clean(grant.project_num || grant.projectNumber || grant.core_project_num);
    const title = clean(grant.project_title || grant.projectTitle) || `NIH RePORTER project ${projectNumber}`;
    const piNames = Array.isArray(grant.principal_investigators)
      ? grant.principal_investigators.map((pi) => clean(pi.full_name || pi.profile_id)).filter(Boolean)
      : [];
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `NIH RePORTER: ${title}`,
      sourceUrl: projectNumber ? `https://reporter.nih.gov/project-details/${encodeURIComponent(projectNumber)}` : "https://reporter.nih.gov/",
      sourceId: projectNumber,
      date: normalizeDate(grant.award_notice_date || grant.project_start_date),
      authors: piNames,
      institution: clean(grant.organization?.org_name || grant.org_name),
      country: clean(grant.organization?.org_country || grant.org_country),
      snippet: trimSnippet(`${title}. ${grant.abstract_text || grant.terms || ""}`),
      impactScore: undefined
    });
  });
}

async function searchPatents(connector, product, query, fetchImpl, limit, now) {
  if (!connector.endpointUrl) {
    throw new Error("patent connector is disabled until a USPTO/PatentsView JSON endpoint or API key is configured");
  }
  const data = await fetchJson(fetchImpl, buildPatentsViewUrl(query, limit));
  return (data.patents || []).map((patent) => {
    const patentId = clean(patent.patent_id || patent.patent_number);
    const title = clean(patent.patent_title) || `Patent ${patentId}`;
    const assignees = Array.isArray(patent.assignees)
      ? patent.assignees.map((assignee) => clean(assignee.assignee_organization)).filter(Boolean)
      : [];
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `PatentsView: ${title}`,
      sourceUrl: patentId ? `https://patents.justia.com/patent/${encodeURIComponent(patentId)}` : "https://patentsview.org/",
      sourceId: patentId,
      date: normalizeDate(patent.patent_date),
      authors: [],
      institution: assignees[0] || "",
      snippet: trimSnippet(`${title}. ${patent.patent_abstract || ""}`),
      impactScore: undefined
    });
  });
}

async function searchCrossrefConferences(connector, product, query, fetchImpl, limit, now) {
  const data = await fetchJson(fetchImpl, buildCrossrefConferenceUrl(query, limit));
  return (data.message?.items || []).map((item) => {
    const doi = clean(item.DOI);
    const title = clean(Array.isArray(item.title) ? item.title[0] : item.title) || `Crossref proceeding ${doi}`;
    const authors = Array.isArray(item.author)
      ? item.author.map((author) => clean(`${author.given || ""} ${author.family || ""}`)).filter(Boolean)
      : [];
    const date = item.published?.["date-parts"]?.[0]?.join("-") || item.created?.["date-time"];
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `Crossref proceedings: ${title}`,
      sourceUrl: item.URL || (doi ? `https://doi.org/${doi}` : "https://www.crossref.org/"),
      sourceId: doi,
      date: normalizeDate(date),
      authors,
      snippet: trimSnippet(`${title}. ${item.abstract || ""}`),
      impactScore: undefined
    });
  });
}

async function searchCrossrefCompanySweep(connector, products, fetchImpl, limit, now, context = {}, searchOptions = connectorSearchOptions()) {
  const records = [];
  const itemsByKey = new Map();
  const pageSize = clampLimitForMode(limit, searchOptions.searchMode);
  const maxPages = Math.max(1, Number.parseInt(String(searchOptions.crossrefMaxPages || 1), 10) || 1);

  for (const query of companySweepQueries(products)) {
    for (let page = 0; page < maxPages; page += 1) {
      const data = await fetchJson(fetchImpl, buildCrossrefConferenceUrl(query, pageSize, {
        searchMode: searchOptions.searchMode,
        offset: page * pageSize,
        startDate: yearsAgoDate(now, searchOptions.crossrefYears),
        endDate: toIsoDate(now)
      }));
      const items = data.message?.items || [];
      for (const item of items) {
        const key = crossrefRecordKey(item);
        if (!itemsByKey.has(key)) itemsByKey.set(key, { item, query });
      }
      if (items.length < pageSize) break;
    }
  }

  for (const { item, query } of itemsByKey.values()) {
    const doi = clean(item.DOI);
    const title = clean(Array.isArray(item.title) ? item.title[0] : item.title) || `Crossref proceeding ${doi}`;
    const authors = Array.isArray(item.author)
      ? item.author.map((author) => clean(`${author.given || ""} ${author.family || ""}`)).filter(Boolean)
      : [];
    const date = item.published?.["date-parts"]?.[0]?.join("-") || item.created?.["date-time"];
    const text = crossrefSearchText(item);
    const companyContexts = nearbyCompanyContexts(text, products);
    const contexts = companyContexts.length
      ? companyContexts
      : fallbackCompanyCorpusContexts(text, query);

    for (const companyContext of contexts) {
      context.corpusRecords?.push(sourceCorpusCandidate({
        connector,
        query,
        now,
        sourceName: "Crossref",
        sourceTitle: `Crossref proceedings: ${title}`,
        sourceUrl: item.URL || (doi ? `https://doi.org/${doi}` : "https://www.crossref.org/"),
        sourceId: doi,
        date: normalizeDate(date),
        authors,
        institution: "",
        contextText: companyContext,
        searchOptions,
        sourceCorpus: "local_crossref_10y"
      }));
    }

    for (const product of products || []) {
      const evidenceContext = productContextFromCompanyContexts(companyContexts, product);
      if (!evidenceContext) continue;
      records.push(candidate({
        connector,
        product,
        query,
        now,
        sourceTitle: `Crossref proceedings: ${title}`,
        sourceUrl: item.URL || (doi ? `https://doi.org/${doi}` : "https://www.crossref.org/"),
        sourceId: doi,
        date: normalizeDate(date),
        authors,
        snippet: trimSnippet([
          `Crossref company-wide context matched ${evidenceContext.matchedTerms.join(", ")} near GeneCopoeia.`,
          evidenceContext.text
        ].filter(Boolean).join(" ")),
        europePmcSentences: evidenceContext.text,
        rawPayload: publicationCorpusRunPayload(searchOptions, now, "Crossref", "local_crossref_10y"),
        impactScore: undefined
      }));
    }
  }

  return records;
}

async function searchOpenAlexProtocols(connector, product, query, fetchImpl, limit, now) {
  const data = await fetchJson(fetchImpl, buildOpenAlexProtocolUrl(query, limit));
  return (data.results || []).map((work) => {
    const title = clean(work.display_name) || `OpenAlex work ${work.id}`;
    const authors = (work.authorships || []).map((authorship) => clean(authorship.author?.display_name)).filter(Boolean);
    const institutions = (work.authorships || [])
      .flatMap((authorship) => authorship.institutions || [])
      .map((institution) => clean(institution.display_name))
      .filter(Boolean);
    return candidate({
      connector,
      product,
      query,
      now,
      sourceTitle: `OpenAlex: ${title}`,
      sourceUrl: work.doi || work.id || "https://openalex.org/",
      sourceId: clean(work.id),
      date: normalizeDate(work.publication_date),
      authors,
      institution: institutions[0] || "",
      country: clean(work.countries_distinct_count ? "" : ""),
      snippet: trimSnippet(`${title}. ${abstractFromInvertedIndex(work.abstract_inverted_index)}`),
      impactScore: Number(work.cited_by_count || 0) ? Math.min(10, Math.log10(Number(work.cited_by_count) + 1) * 3) : undefined
    });
  });
}

async function searchCustomSocial(connector, product, query, fetchImpl, limit, now) {
  if (!connector.endpointUrl) return [];
  const data = await fetchJson(fetchImpl, connector.endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, productId: product.id, limit: clampLimit(limit) })
  });
  return (data.records || data.mentions || []).map((mention) => candidate({
    connector,
    product,
    query,
    now,
    sourceTitle: clean(mention.title) || `Social mention for ${product.productName}`,
    sourceUrl: clean(mention.url),
    sourceId: clean(mention.id),
    date: normalizeDate(mention.date),
    authors: [clean(mention.author)].filter(Boolean),
    institution: clean(mention.institution),
    country: clean(mention.country),
    snippet: trimSnippet(mention.snippet || mention.text || ""),
    impactScore: undefined
  }));
}

async function fetchJson(fetchImpl, url, options = {}) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options
    });
    if (response.ok) break;
    if (response.status !== 429 || attempt === 1) break;
    await delay(650);
  }
  if (!response?.ok) {
    const status = response?.status ? `HTTP ${response.status}` : "request failed";
    throw new Error(`${status}; try a narrower Genecopoeia catalog number or run again after the source rate limit resets`);
  }
  return parseJsonResponse(response);
}

async function fetchText(fetchImpl, url, options = {}) {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetchImpl(url, {
      headers: { Accept: "text/xml,text/plain,application/xml", ...(options.headers || {}) },
      ...options
    });
    if (response.ok) break;
    if (response.status !== 429 || attempt === 1) break;
    await delay(650);
  }
  if (!response?.ok) {
    const status = response?.status ? `HTTP ${response.status}` : "request failed";
    throw new Error(status);
  }
  if (typeof response.text === "function") return response.text();
  if (typeof response.json === "function") return JSON.stringify(await response.json());
  return "";
}

async function parseJsonResponse(response) {
  if (typeof response.text === "function") {
    const text = await response.text();
    const contentType = response.headers?.get?.("content-type") || "";
    if (/html/i.test(contentType) || /^\s*</.test(text)) {
      throw new Error("source returned HTML instead of JSON; the endpoint is unavailable or requires updated configuration");
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`source returned invalid JSON: ${error.message}`);
    }
  }
  return response.json();
}

async function fetchEuropePmcFullText(item, fetchImpl, context = {}) {
  const url = europePmcFullTextXmlUrl(item);
  if (!url) return "";
  const cacheKey = `europepmc-fulltext:${url}`;
  if (context.cache?.has(cacheKey)) return context.cache.get(cacheKey);
  try {
    const xml = await fetchText(fetchImpl, url);
    const text = textFromXml(xml);
    context.cache?.set(cacheKey, text);
    return text;
  } catch {
    context.cache?.set(cacheKey, "");
    return "";
  }
}

async function fetchPubMedArticleTexts(ids, fetchImpl, context = {}) {
  if (!ids.length) return new Map();
  const cacheKey = `pubmed-efetch:${ids.join(",")}`;
  if (context.cache?.has(cacheKey)) return context.cache.get(cacheKey);
  try {
    const xml = await fetchText(fetchImpl, buildPubMedFetchUrl(ids));
    const articles = pubMedArticlesFromXml(xml);
    context.cache?.set(cacheKey, articles);
    return articles;
  } catch {
    const empty = new Map();
    context.cache?.set(cacheKey, empty);
    return empty;
  }
}

function pubMedArticlesFromXml(xml) {
  const articles = new Map();
  const blocks = [...String(xml || "").matchAll(/<PubmedArticle[\s\S]*?<\/PubmedArticle>/gi)].map((match) => match[0]);
  for (const block of blocks) {
    const id = clean(block.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/i)?.[1]);
    if (!id) continue;
    const title = textFromXml(block.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/i)?.[1] || "");
    const abstract = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)]
      .map((match) => textFromXml(match[1]))
      .filter(Boolean)
      .join(" ");
    articles.set(id, {
      title,
      text: [title, abstract].filter(Boolean).join(" ")
    });
  }
  return articles;
}

function europePmcFullTextXmlUrl(item) {
  if (!shouldFetchEuropePmcFullText(item)) return "";
  const pmcid = clean(item.pmcid);
  if (pmcid) return buildEuropePmcFullTextXmlUrl(pmcid);
  const source = clean(item.source);
  const id = clean(item.id);
  if (/^PMC$/i.test(source) && id) return buildEuropePmcFullTextXmlUrl(id);
  if (/^PMC/i.test(id)) return buildEuropePmcFullTextXmlUrl(id);
  return "";
}

function shouldFetchEuropePmcFullText(item) {
  return Boolean(
    clean(item.pmcid) ||
    /^PMC$/i.test(clean(item.source)) ||
    /^PMC/i.test(clean(item.id)) ||
    /^(y|yes|true|1)$/i.test(clean(String(item.hasFullText || item.hasFullTextXML || item.isOpenAccess || "")))
  );
}

function nearbyCompanyProductContext(text, product) {
  return productContextFromCompanyContexts(nearbyCompanyContexts(text, [product]), product);
}

function nearbyCompanyContexts(text, products = []) {
  const sentences = splitSentences(textFromXml(text));
  const companyTerms = companyContextTerms(products);
  const contexts = [];
  for (let index = 0; index < sentences.length; index += 1) {
    if (!companyTerms.some((term) => containsNormalizedTerm(sentences[index], term))) continue;
    contexts.push(trimEuropePmcContext(sentences.slice(Math.max(0, index - 2), Math.min(sentences.length, index + 3)).join(" ")));
  }
  return unique(contexts);
}

function fallbackCompanyCorpusContexts(text, query) {
  const value = trimEuropePmcContext(text);
  if (!value) return [`${query} metadata hit. Review source before treating this candidate as product-use evidence.`];
  if (containsNormalizedTerm(value, query)) return [value];
  return [`${query} metadata hit. ${value}`].map(trimEuropePmcContext);
}

export function productContextFromCompanyContexts(contexts, product) {
  const productTerms = productContextTerms(product);
  for (const context of contexts) {
    if (hasSameFamilyCatalogConflict(context, product)) continue;
    const matchedTerms = productTerms.filter((term) => containsNormalizedTerm(context, term));
    if (!matchedTerms.length) continue;
    return {
      text: trimEuropePmcContext(context),
      matchedTerms: unique(matchedTerms).slice(0, 4)
    };
  }
  return null;
}

function normalizePmcid(value) {
  const text = clean(String(value || ""));
  return /^PMC/i.test(text) ? `PMC${text.replace(/^PMC[_-]?/i, "")}` : `PMC${text}`;
}

function trimEuropePmcContext(value) {
  return clean(String(value || "").replace(/<[^>]+>/g, " ")).slice(0, 1200);
}

function productContextTerms(product) {
  return unique([
    product.catalogNumber,
    product.rrid,
    product.productName,
    ...catalogTermsFromProductName(product.productName),
    ...(product.synonyms || [])
  ].map(clean)).filter((term) => normalizeMatchText(term).length >= 3);
}

function productCatalogTerms(product) {
  return unique([
    product.catalogNumber,
    product.rrid,
    ...catalogTermsFromProductName(product.productName),
    ...(product.synonyms || []).filter((term) => catalogLikeTerms(term).length)
  ].map(clean)).filter(Boolean);
}

function catalogTermsFromProductName(productName) {
  const text = clean(productName);
  if (!text) return [];
  return [...text.matchAll(/Old Cat #\s*([A-Z]{1,6}\d{2,6}(?:[-_][A-Z0-9]+)?)/gi)]
    .map((match) => match[1]);
}

function hasSameFamilyCatalogConflict(text, product) {
  const contextCodes = catalogLikeTerms(text).map(compactCode).filter(Boolean);
  const productCodes = productCatalogTerms(product).flatMap(catalogLikeTerms).map(compactCode).filter(Boolean);
  if (!contextCodes.length || !productCodes.length) return false;

  return contextCodes.some((contextCode) => {
    if (productCodes.some((productCode) => compatibleCatalogCode(contextCode, productCode))) return false;
    const contextPrefix = catalogPrefix(contextCode);
    return contextPrefix && productCodes.some((productCode) => catalogPrefix(productCode) === contextPrefix);
  });
}

function compatibleCatalogCode(left, right) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function catalogLikeTerms(value) {
  return [...String(value || "").matchAll(/\b[A-Z]{1,6}\d{2,6}(?:[-_][A-Z0-9]{1,8})*\b/gi)]
    .map((match) => match[0]);
}

function catalogPrefix(value) {
  return String(value || "").match(/^[A-Z]+/)?.[0] || "";
}

function compactCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function companyContextTerms(products = []) {
  return unique([
    ...(products || []).flatMap((product) => [
      clean(product.company) || "GeneCopoeia",
      ...companyVariants(clean(product.company) || "GeneCopoeia")
    ]),
    "GeneCopoeia",
    "Gene Copoeia"
  ].map(clean)).filter(Boolean);
}

function containsCompanyMention(value, product) {
  return [
    clean(product.company) || "GeneCopoeia",
    "GeneCopoeia",
    "Gene Copoeia"
  ].some((term) => containsNormalizedTerm(value, term));
}

function containsNormalizedTerm(value, term) {
  const normalizedText = normalizeMatchText(value);
  const normalizedTerm = normalizeMatchText(term);
  if (!normalizedTerm) return false;
  const compactText = normalizedText.replace(/\s+/g, "");
  const compactTerm = normalizedTerm.replace(/\s+/g, "");
  return normalizedText.includes(normalizedTerm) || compactText.includes(compactTerm);
}

function splitSentences(value) {
  const text = clean(value);
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(clean)
    .filter(Boolean);
}

function textFromXml(value) {
  return decodeXmlEntities(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function buildPubMedTerm(query, searchMode = "standard") {
  const terms = splitCompanyQuery(query);
  const field = searchMode === "deep" || searchMode === "exhaustive10y" ? "All Fields" : "Title/Abstract";
  if (terms.length <= 1) return `${quotePhrase(query)}[${field}]`;
  return terms.map((term) => `${quotePhrase(term)}[${field}]`).join(" AND ");
}

function buildBooleanQuery(query) {
  const terms = splitCompanyQuery(query);
  return terms.map(quotePhrase).join(" AND ");
}

function buildPatentsViewQuery(query) {
  const terms = splitCompanyQuery(query);
  if (terms.length <= 1) {
    return { _text_any: { patent_title: query, patent_abstract: query } };
  }
  return {
    _and: terms.map((term) => ({
      _text_any: {
        patent_title: term,
        patent_abstract: term
      }
    }))
  };
}

function splitCompanyQuery(query) {
  const text = clean(query);
  const match = text.match(/^(genecopoeia|gene copoeia)\s+(.+)$/i);
  if (!match) return [text].filter(Boolean);
  const company = /^gene copoeia$/i.test(match[1]) ? "Gene Copoeia" : "GeneCopoeia";
  return [company, match[2].trim()].filter(Boolean);
}

function quotePhrase(value) {
  const text = clean(value).replace(/"/g, "");
  return /\s/.test(text) ? `"${text}"` : text;
}

function candidate({ connector, product, query, now, sourceTitle, sourceUrl, sourceId, date, authors = [], institution = "", country = "", snippet, europePmcSentences = "", rawPayload = {}, impactScore }) {
  const id = buildCandidateId(connector.id, product.id, sourceId || sourceUrl || sourceTitle);
  return {
    id,
    connectorId: connector.id,
    sourceType: connector.sourceType,
    sourceTitle,
    sourceUrl,
    sourceId,
    date: date || toIsoDate(now),
    authors,
    institution,
    country,
    productId: product.id,
    productName: product.productName,
    snippet: snippet || `${connector.name} matched ${query}. Review source before curating.`,
    europePmcSentences: clean(europePmcSentences) || undefined,
    productMentionType: "connector_candidate",
    confidenceScore: connector.defaultConfidence,
    reviewStatus: "candidate",
    diseaseAreas: [],
    impactScore,
    rawPayload: {
      connectorId: connector.id,
      productId: product.id,
      query,
      europePmcSentences: clean(europePmcSentences) || undefined,
      importedAt: now.toISOString(),
      ...rawPayload
    }
  };
}

function sourceCorpusCandidate({ connector, query, now, sourceName, sourceTitle, sourceUrl, sourceId, date, authors = [], institution = "", country = "", contextText, searchOptions, sourceCorpus }) {
  const contextTextClean = trimEuropePmcContext(contextText);
  return {
    id: `CORPUS-${connector.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${hash(`${sourceId || sourceUrl || sourceTitle}:${contextTextClean}`)}`,
    connectorId: connector.id,
    sourceType: connector.sourceType,
    sourceTitle,
    sourceUrl,
    sourceId,
    date: date || toIsoDate(now),
    authors,
    institution,
    country,
    snippet: trimSnippet(`Saved ${sourceName} GeneCopoeia corpus context. ${contextTextClean}`),
    europePmcSentences: contextTextClean,
    productMentionType: "company_context",
    contextLabel: "unclear",
    confidenceScore: connector.defaultConfidence,
    reviewStatus: "candidate",
    products: [],
    competitorMentions: [],
    rawPayload: {
      connectorId: connector.id,
      query,
      sourceCorpus,
      europePmcSentences: contextTextClean,
      importedAt: now.toISOString(),
      ...publicationCorpusRunPayload(searchOptions, now, sourceName, sourceCorpus),
      searchStrategy: "company_first_10y"
    }
  };
}

function companyCorpusCandidate({ connector, query, now, item, title, sourceId, companyContext, searchOptions }) {
  const sourceUrl = europePmcUrl(item);
  const contextText = trimEuropePmcContext(companyContext);
  return {
    id: `CORPUS-${connector.id.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${hash(`${sourceId || sourceUrl || title}:${contextText}`)}`,
    connectorId: connector.id,
    sourceType: connector.sourceType,
    sourceTitle: `Europe PMC: ${title}`,
    sourceUrl,
    sourceId,
    date: normalizeDate(item.firstPublicationDate || item.firstIndexDate || item.pubYear) || toIsoDate(now),
    authors: splitAuthors(item.authorString),
    institution: clean(item.affiliation),
    country: "",
    snippet: trimSnippet(`Saved Europe PMC GeneCopoeia corpus context. ${contextText}`),
    europePmcSentences: contextText,
    productMentionType: "company_context",
    contextLabel: "unclear",
    confidenceScore: connector.defaultConfidence,
    reviewStatus: "candidate",
    products: [],
    competitorMentions: [],
    rawPayload: {
      connectorId: connector.id,
      query,
      sourceCorpus: "local_europe_pmc_10y",
      europePmcSentences: contextText,
      importedAt: now.toISOString(),
      ...europePmcRunPayload(searchOptions, now),
      searchStrategy: "company_first_10y"
    }
  };
}

function dedupeCandidates(records) {
  return [...new Map(records.map((record) => [record.id, record])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildCandidateId(connectorId, productId, sourceKey) {
  return `AUTO-${connectorId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${productId}-${hash(sourceKey)}`;
}

function abstractFromInvertedIndex(index) {
  if (!index || typeof index !== "object") return "";
  const entries = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) entries[position] = word;
  }
  return entries.filter(Boolean).join(" ");
}

function europePmcUrl(item) {
  const pmcid = clean(item.pmcid);
  if (pmcid) return `https://europepmc.org/article/PMC/${pmcid.replace(/^PMC/i, "")}`;
  const pmid = clean(item.pmid);
  if (pmid) return `https://europepmc.org/article/MED/${pmid}`;
  const doi = clean(item.doi);
  if (doi) return `https://doi.org/${doi}`;
  const id = clean(item.id);
  return id ? `https://europepmc.org/article/${clean(item.source) || "EXT"}/${id}` : "https://europepmc.org/";
}

function bioRxivSearchText(item) {
  return [
    item.title,
    item.abstract,
    item.authors,
    item.author_corresponding,
    item.author_corresponding_institution,
    item.category,
    item.doi
  ].map(clean).filter(Boolean).join(" ");
}

function bioRxivSourceId(item) {
  const doi = clean(item.doi);
  const version = clean(String(item.version || ""));
  return version && doi && !doi.endsWith(`v${version}`) ? `${doi}v${version}` : doi;
}

function bioRxivUrl(item) {
  const sourceId = bioRxivSourceId(item);
  return sourceId ? `https://www.biorxiv.org/content/${sourceId}` : "https://www.biorxiv.org/";
}

function crossrefSearchText(item) {
  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  const subtitle = Array.isArray(item.subtitle) ? item.subtitle.join(" ") : item.subtitle;
  const container = Array.isArray(item["container-title"]) ? item["container-title"].join(" ") : item["container-title"];
  return [
    title,
    subtitle,
    item.abstract,
    container,
    item.DOI,
    item.URL
  ].map(clean).filter(Boolean).join(" ");
}

function formatPubMedAuthors(authors) {
  if (!Array.isArray(authors)) return [];
  return authors.map((author) => clean(author.name)).filter(Boolean);
}

function splitAuthors(value) {
  return clean(value)
    .split(/\s*(?:,|;)\s*/)
    .map(clean)
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeDate(value) {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ? `${year}-01-01` : "";
}

function trimSnippet(value) {
  return clean(String(value || "").replace(/<[^>]+>/g, " ")).slice(0, 600);
}

function matchesAllQueryTerms(value, query) {
  const text = normalizeMatchText(value);
  const compactText = text.replace(/\s+/g, "");
  return splitCompanyQuery(query).every((term) => {
    const normalized = normalizeMatchText(term);
    const compactTerm = normalized.replace(/\s+/g, "");
    return !normalized || text.includes(normalized) || compactText.includes(compactTerm);
  });
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function yearsAgoDate(date, years) {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() - Math.max(1, Number(years) || 1));
  return toIsoDate(copy);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function clampLimitForMode(limit, searchMode) {
  if (searchMode === "exhaustive10y") return clampEuropePmcPageSize(limit);
  return clampLimit(limit);
}

function clampEuropePmcPageSize(limit) {
  const parsed = Number.parseInt(String(limit ?? 25), 10);
  if (Number.isNaN(parsed)) return 25;
  return Math.max(1, Math.min(1000, parsed));
}

function clampLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? 2), 10);
  if (Number.isNaN(parsed)) return 2;
  return Math.max(1, Math.min(10, parsed));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value) {
  let output = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    output = ((output << 5) - output + text.charCodeAt(index)) | 0;
  }
  return Math.abs(output).toString(36).toUpperCase();
}
