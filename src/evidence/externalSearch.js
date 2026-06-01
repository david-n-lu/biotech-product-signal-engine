const NCBI_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT_SEARCH_URL = "https://rest.uniprot.org/uniprotkb/search";
const ALPHAFOLD_PREDICTION_URL = "https://alphafold.ebi.ac.uk/api/prediction";

const SOURCE_LABELS = {
  pubmed: "PubMed",
  clinvar: "ClinVar",
  uniprot: "UniProtKB",
  alphafold: "AlphaFold DB"
};

/**
 * Search external resources and map returned hits into conservative candidate
 * evidence records. A search hit is not treated as proof; it is imported as
 * provenance-rich context for scientist review.
 *
 * @param {Object} params
 * @param {string} params.gene
 * @param {string=} params.disease
 * @param {string[]=} params.sources
 * @param {number=} params.limit
 * @param {typeof fetch=} params.fetchImpl
 * @param {Date=} params.now
 * @returns {Promise<{records: import("../domain/types.js").EvidenceRecord[], errors: string[]}>}
 */
export async function searchEvidenceSources(params) {
  const gene = clean(params.gene);
  const disease = clean(params.disease);
  const sources = normalizeSources(params.sources);
  const limit = clampLimit(params.limit);
  const fetchImpl = params.fetchImpl || globalThis.fetch;
  const accessedAt = toIsoDate(params.now || new Date());

  if (!gene) {
    return { records: [], errors: ["Enter a gene before searching evidence sources."] };
  }
  if (typeof fetchImpl !== "function") {
    return { records: [], errors: ["Evidence search needs a browser or runtime with fetch support."] };
  }

  const records = [];
  const errors = [];
  let uniprotRecords = [];

  for (const source of sources) {
    try {
      if (source === "pubmed") {
        records.push(...await searchPubMed({ gene, disease, limit, accessedAt, fetchImpl }));
      }
      if (source === "clinvar") {
        records.push(...await searchClinVar({ gene, disease, limit, accessedAt, fetchImpl }));
      }
      if (source === "uniprot") {
        uniprotRecords = await searchUniProt({ gene, disease, limit, accessedAt, fetchImpl });
        records.push(...uniprotRecords);
      }
      if (source === "alphafold") {
        if (uniprotRecords.length === 0) {
          uniprotRecords = await searchUniProt({ gene, disease, limit, accessedAt, fetchImpl });
        }
        records.push(...await searchAlphaFold({ gene, disease, uniprotRecords, accessedAt, fetchImpl }));
      }
    } catch (error) {
      errors.push(`${SOURCE_LABELS[source]} search failed: ${error.message}`);
    }
  }

  return { records: uniqueById(records), errors };
}

export function buildPubMedSearchUrl(gene, disease, limit) {
  return buildNcbiUrl("esearch", {
    db: "pubmed",
    term: buildGeneDiseaseTerm(gene, disease, "Title/Abstract"),
    retmode: "json",
    retmax: String(clampLimit(limit)),
    sort: "relevance"
  });
}

export function buildPubMedSummaryUrl(ids) {
  return buildNcbiUrl("esummary", {
    db: "pubmed",
    id: ids.join(","),
    retmode: "json"
  });
}

export function buildClinVarSearchUrl(gene, disease, limit) {
  return buildNcbiUrl("esearch", {
    db: "clinvar",
    term: disease ? `${gene}[gene] AND ${disease}` : `${gene}[gene]`,
    retmode: "json",
    retmax: String(clampLimit(limit))
  });
}

export function buildClinVarSummaryUrl(ids) {
  return buildNcbiUrl("esummary", {
    db: "clinvar",
    id: ids.join(","),
    retmode: "json"
  });
}

export function buildUniProtSearchUrl(gene, limit) {
  const url = new URL(UNIPROT_SEARCH_URL);
  url.search = new URLSearchParams({
    query: `(gene:${gene}) AND (organism_id:9606)`,
    format: "json",
    size: String(clampLimit(limit))
  }).toString();
  return url.toString();
}

export function buildAlphaFoldPredictionUrl(accession) {
  return `${ALPHAFOLD_PREDICTION_URL}/${encodeURIComponent(accession)}`;
}

async function searchPubMed({ gene, disease, limit, accessedAt, fetchImpl }) {
  const search = await fetchJson(fetchImpl, buildPubMedSearchUrl(gene, disease, limit));
  const ids = search.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const summary = await fetchJson(fetchImpl, buildPubMedSummaryUrl(ids));
  return (summary.result?.uids || ids).map((uid) => {
    const item = summary.result?.[uid] || {};
    const title = clean(item.title) || `PubMed record ${uid}`;
    return {
      id: `PUBMED:${uid}`,
      source: {
        title: `PubMed: ${title}`,
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        accessedAt,
        database: "PubMed",
        recordId: String(uid)
      },
      evidenceType: "other",
      claim: `PubMed result matched the query for ${formatGeneDisease(gene, disease)}: ${title}. Review the article before treating it as supporting evidence.`,
      supports: "context",
      confidence: 0.25,
      entities: entitySet(gene, disease),
      notes: [
        clean(item.fulljournalname) || clean(item.source),
        clean(item.pubdate),
        formatAuthors(item.authors)
      ].filter(Boolean).join(" | ") || undefined
    };
  });
}

async function searchClinVar({ gene, disease, limit, accessedAt, fetchImpl }) {
  const search = await fetchJson(fetchImpl, buildClinVarSearchUrl(gene, disease, limit));
  const ids = search.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const summary = await fetchJson(fetchImpl, buildClinVarSummaryUrl(ids));
  return (summary.result?.uids || ids).map((uid) => {
    const item = summary.result?.[uid] || {};
    const title = clean(item.title) || clean(item.accession) || `ClinVar record ${uid}`;
    const classification = clean(item.germline_classification?.description)
      || clean(item.clinical_significance?.description)
      || clean(item.clinical_significance);
    return {
      id: `CLINVAR:${uid}`,
      source: {
        title: `ClinVar: ${title}`,
        url: `https://www.ncbi.nlm.nih.gov/clinvar/variation/${uid}/`,
        accessedAt,
        database: "ClinVar",
        recordId: String(uid)
      },
      evidenceType: "genetic_association",
      claim: `ClinVar record matched the query for ${formatGeneDisease(gene, disease)}: ${title}${classification ? `; reported classification: ${classification}` : ""}. Review the ClinVar assertion details before treating it as supporting evidence.`,
      supports: "context",
      confidence: 0.35,
      entities: entitySet(gene, disease),
      notes: [
        clean(item.variation_type || item.variant_type),
        classification,
        clean(item.last_evaluated)
      ].filter(Boolean).join(" | ") || undefined
    };
  });
}

async function searchUniProt({ gene, disease, limit, accessedAt, fetchImpl }) {
  const data = await fetchJson(fetchImpl, buildUniProtSearchUrl(gene, limit));
  return (data.results || []).map((entry) => {
    const accession = clean(entry.primaryAccession);
    const proteinName = getProteinName(entry) || accession || "UniProtKB entry";
    const geneName = getGeneName(entry) || gene;
    return {
      id: `UNIPROT:${accession || clean(entry.uniProtkbId)}`,
      source: {
        title: `UniProtKB: ${proteinName}`,
        url: accession ? `https://www.uniprot.org/uniprotkb/${accession}/entry` : "https://www.uniprot.org/",
        accessedAt,
        database: "UniProtKB",
        recordId: accession || clean(entry.uniProtkbId) || undefined
      },
      evidenceType: "functional",
      claim: `UniProtKB entry matched ${geneName}. Review protein function, annotation evidence, and cross-references before using this as functional evidence.`,
      supports: "context",
      confidence: 0.35,
      entities: entitySet(geneName, disease),
      notes: [
        clean(entry.uniProtkbId),
        clean(entry.organism?.scientificName),
        getAlphaFoldCrossReference(entry) ? `AlphaFoldDB: ${getAlphaFoldCrossReference(entry)}` : ""
      ].filter(Boolean).join(" | ") || undefined
    };
  }).filter((record) => record.id !== "UNIPROT:");
}

async function searchAlphaFold({ gene, disease, uniprotRecords, accessedAt, fetchImpl }) {
  const records = [];
  for (const uniprotRecord of uniprotRecords) {
    const accession = uniprotRecord.source.recordId;
    if (!accession) continue;
    const predictions = await fetchJson(fetchImpl, buildAlphaFoldPredictionUrl(accession));
    for (const prediction of Array.isArray(predictions) ? predictions : []) {
      const entryId = clean(prediction.entryId) || `AF-${accession}-F1`;
      const description = clean(prediction.uniprotDescription) || clean(prediction.uniprotId) || accession;
      records.push({
        id: `ALPHAFOLD:${entryId}`,
        source: {
          title: `AlphaFold DB: ${description}`,
          url: `https://alphafold.ebi.ac.uk/entry/${entryId}`,
          accessedAt,
          database: "AlphaFold DB",
          recordId: entryId
        },
        evidenceType: "technology",
        claim: `AlphaFold DB has a predicted protein structure entry for ${gene} (${accession}). This is structural context, not disease evidence; review model confidence and limitations before using it for experiment design.`,
        supports: "context",
        confidence: 0.3,
        entities: {
          ...entitySet(gene, disease),
          technology: "AlphaFold DB"
        },
        notes: [
          clean(prediction.organismScientificName),
          prediction.cifUrl ? `CIF: ${prediction.cifUrl}` : "",
          prediction.pdbUrl ? `PDB: ${prediction.pdbUrl}` : "",
          prediction.paeDocUrl ? `PAE: ${prediction.paeDocUrl}` : ""
        ].filter(Boolean).join(" | ") || undefined
      });
    }
  }
  return records;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function buildNcbiUrl(utility, params) {
  const url = new URL(`${NCBI_BASE_URL}/${utility}.fcgi`);
  url.search = new URLSearchParams(params).toString();
  return url.toString();
}

function buildGeneDiseaseTerm(gene, disease, field) {
  const geneTerm = `${gene}[${field}]`;
  if (!disease) return geneTerm;
  return `(${geneTerm}) AND (${disease}[${field}])`;
}

function normalizeSources(sources) {
  const requested = Array.isArray(sources) && sources.length
    ? sources
    : ["pubmed", "clinvar", "uniprot", "alphafold"];
  return requested.filter((source) => Object.hasOwn(SOURCE_LABELS, source));
}

function uniqueById(records) {
  return [...new Map(records.map((record) => [record.id, record])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}

function entitySet(gene, disease) {
  const entities = { gene };
  if (disease) entities.disease = disease;
  return entities;
}

function formatGeneDisease(gene, disease) {
  return disease ? `${gene} and ${disease}` : gene;
}

function formatAuthors(authors) {
  if (!Array.isArray(authors) || authors.length === 0) return "";
  const names = authors.map((author) => clean(author.name)).filter(Boolean);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} et al.`;
}

function getProteinName(entry) {
  return clean(entry.proteinDescription?.recommendedName?.fullName?.value)
    || clean(entry.proteinDescription?.submissionNames?.[0]?.fullName?.value);
}

function getGeneName(entry) {
  return clean(entry.genes?.[0]?.geneName?.value);
}

function getAlphaFoldCrossReference(entry) {
  const refs = entry.uniProtKBCrossReferences || [];
  return clean(refs.find((ref) => ref.database === "AlphaFoldDB")?.id);
}

function clampLimit(limit) {
  const parsed = Number.parseInt(String(limit ?? 3), 10);
  if (Number.isNaN(parsed)) return 3;
  return Math.max(1, Math.min(10, parsed));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
