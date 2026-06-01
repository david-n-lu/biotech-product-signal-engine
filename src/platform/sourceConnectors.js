const NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CLINICAL_TRIALS = "https://clinicaltrials.gov/api/v2/studies";
const NIH_REPORTER = "https://api.reporter.nih.gov/v2/projects/search";
const PATENTSVIEW = "https://api.patentsview.org/patents/query";
const EUROPE_PMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const BIORXIV_DETAILS = "https://api.biorxiv.org/details/biorxiv";
const CROSSREF_WORKS = "https://api.crossref.org/v1/works";
const OPENALEX_WORKS = "https://api.openalex.org/works";

export const PUBLICATION_CONNECTOR_IDS = [
  "pubmed_publications",
  "europepmc_fulltext_publications",
  "biorxiv_preprints"
];

const SEARCH_MODE_CONFIG = {
  standard: {
    queryLimit: 2,
    perQueryLimit: undefined,
    pubMedPages: 1
  },
  deep: {
    queryLimit: 8,
    perQueryLimit: 10,
    pubMedPages: 3
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
  const selectedProducts = products.slice(0, 50);
  const runContext = { cache: new Map() };
  const searchOptions = connectorSearchOptions(searchMode, perProductLimit);

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
    errors.push(...result.errors);
    notices.push(...(result.notices || []));
  }

  return {
    records: dedupeCandidates(records),
    errors,
    notices,
    runs
  };
}

export function buildProductQueries(product, options = {}) {
  const company = clean(product.company) || "GeneCopoeia";
  const searchMode = options.searchMode || "standard";
  const identifiers = [product.catalogNumber, product.rrid].map(clean).filter(Boolean);
  const names = [
    product.productName,
    ...(product.synonyms || []).slice(0, searchMode === "deep" ? 6 : 2)
  ].map(clean).filter(Boolean);
  const identityTerms = searchMode === "deep"
    ? [...identifiers, ...names.flatMap(queryVariants)]
    : [...identifiers, ...names];
  const companyTerms = searchMode === "deep" ? companyVariants(company) : [company];
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
    perQueryLimit: requestedLimit > 0 ? clampLimit(requestedLimit) : clampLimit(fallbackLimit),
    pubMedPages: Math.max(1, Number.parseInt(String(config.pubMedPages || 1), 10) || 1)
  };
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
  url.search = new URLSearchParams({
    db: "pubmed",
    term: buildPubMedTerm(query, options.searchMode),
    retmode: "json",
    retmax: String(clampLimit(limit)),
    retstart: String(Math.max(0, Number.parseInt(String(retstart || 0), 10) || 0)),
    sort: "pub date"
  }).toString();
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

export function buildEuropePmcSearchUrl(query, limit) {
  const url = new URL(EUROPE_PMC_SEARCH);
  url.search = new URLSearchParams({
    query: buildBooleanQuery(query),
    format: "json",
    pageSize: String(clampLimit(limit)),
    resultType: "core",
    sort: "FIRST_PDATE_D desc"
  }).toString();
  return url.toString();
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

export function buildCrossrefConferenceUrl(query, limit) {
  const url = new URL(CROSSREF_WORKS);
  url.search = new URLSearchParams({
    "query.bibliographic": quotePhrase(query),
    filter: "type:proceedings-article",
    rows: String(clampLimit(limit)),
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
  if (connector.id === "europepmc_fulltext_publications") return searchEuropePmc(connector, product, query, fetchImpl, limit, now);
  if (connector.id === "biorxiv_preprints") return searchBioRxiv(connector, product, query, fetchImpl, limit, now, context);
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

async function searchEuropePmc(connector, product, query, fetchImpl, limit, now) {
  const data = await fetchJson(fetchImpl, buildEuropePmcSearchUrl(query, limit));
  return (data.resultList?.result || []).map((item) => {
    const sourceId = clean(item.pmid || item.pmcid || item.doi || item.id);
    const title = clean(item.title) || `Europe PMC record ${sourceId}`;
    return candidate({
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
        `Europe PMC matched ${query} in publication metadata or searchable full text.`,
        title,
        clean(item.abstractText)
      ].filter(Boolean).join(" ")),
      impactScore: Number(item.citedByCount || 0) ? Math.min(10, Math.log10(Number(item.citedByCount) + 1) * 3) : undefined
    });
  });
}

async function searchBioRxiv(connector, product, query, fetchImpl, limit, now, context = {}) {
  const toDate = toIsoDate(now);
  const fromDate = toIsoDate(addDays(now, -365));
  const url = buildBioRxivDetailsUrl(fromDate, toDate, 0);
  const cacheKey = `biorxiv:${url}`;
  const data = context.cache?.get(cacheKey) || await fetchJson(fetchImpl, url);
  context.cache?.set(cacheKey, data);
  return (data.collection || [])
    .filter((item) => matchesAllQueryTerms(bioRxivSearchText(item), query))
    .slice(0, clampLimit(limit))
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
        impactScore: undefined
      });
    });
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

function buildPubMedTerm(query, searchMode = "standard") {
  const terms = splitCompanyQuery(query);
  const field = searchMode === "deep" ? "All Fields" : "Title/Abstract";
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

function candidate({ connector, product, query, now, sourceTitle, sourceUrl, sourceId, date, authors = [], institution = "", country = "", snippet, impactScore }) {
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
    productMentionType: "connector_candidate",
    confidenceScore: connector.defaultConfidence,
    reviewStatus: "candidate",
    diseaseAreas: [],
    impactScore,
    rawPayload: {
      connectorId: connector.id,
      productId: product.id,
      query,
      importedAt: now.toISOString()
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

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
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
