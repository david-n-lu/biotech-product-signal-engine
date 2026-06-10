import { parseCsv } from "./ingestion.js";
import { europePmcSentencesText } from "./europePmcSentences.js";
import { productContextFromCompanyContexts } from "./sourceConnectors.js";

export const PRODUCT_EVIDENCE_CORPUS_HEADERS = Object.freeze([
  "productId",
  "company",
  "productName",
  "catalogNumber",
  "rrid",
  "productType",
  "applicationArea",
  "synonyms",
  "competitorEquivalents",
  "internalOwner",
  "evidenceId",
  "sourceType",
  "sourceTitle",
  "sourceUrl",
  "sourceId",
  "date",
  "authors",
  "institution",
  "country",
  "contextLabel",
  "europePmcSentences",
  "reviewStatus",
  "connectorId",
  "confidenceScore",
  "productMentionType",
  "matchedText",
  "mentionConfidence",
  "competitors",
  "provenance"
]);

const DEFAULT_CONNECTOR_ID = "europepmc_fulltext_publications";

export function exportCompanyCorpusCsv(records = []) {
  const rows = (records || []).map(companyCorpusRow);
  return [
    PRODUCT_EVIDENCE_CORPUS_HEADERS.join(","),
    ...rows.map((row) => PRODUCT_EVIDENCE_CORPUS_HEADERS.map((header) => csv(row[header])).join(","))
  ].join("\n");
}

export function importCompanyCorpusCsvText(text) {
  if (!String(text || "").trim()) return { records: [], errors: [] };
  const parsed = parseCsv(text);
  if (parsed.errors.length) return { records: [], errors: parsed.errors };

  const records = [];
  const errors = [];
  parsed.rows.forEach((row, index) => {
    const record = companyCorpusRecord(row);
    if (!record.sourceTitle) {
      errors.push(`Company corpus row ${index + 1}: sourceTitle is required.`);
      return;
    }
    if (!record.sourceUrl && !record.sourceId) {
      errors.push(`Company corpus row ${index + 1}: sourceUrl or sourceId is required.`);
      return;
    }
    if (!europePmcSentencesText(record)) {
      errors.push(`Company corpus row ${index + 1}: europePmcSentences is required.`);
      return;
    }
    records.push(record);
  });

  return { records, errors };
}

export function linkCompanyCorpusRecordsToProducts(records = [], products = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const linked = [];
  for (const record of records || []) {
    const context = europePmcSentencesText(record);
    if (!context) continue;
    for (const product of products || []) {
      const evidenceContext = productContextFromCompanyContexts([context], product);
      if (!evidenceContext) continue;
      linked.push(companyCorpusProductCandidate(record, product, evidenceContext, now));
    }
  }
  return dedupeRecords(linked);
}

export function companyCorpusStats(records = []) {
  const sourceIds = new Set();
  const contexts = new Set();
  for (const record of records || []) {
    sourceIds.add(record.sourceId || record.sourceUrl || record.sourceTitle || record.id);
    contexts.add(europePmcSentencesText(record) || record.id);
  }
  return {
    records: records.length,
    sources: sourceIds.size,
    contexts: contexts.size
  };
}

function companyCorpusRow(record) {
  const mention = (record.products || [])[0] || {};
  return {
    productId: mention.productId || record.productId || "",
    company: record.company || "GeneCopoeia",
    productName: mention.productName || record.productName || "",
    catalogNumber: record.catalogNumber || "",
    rrid: record.rrid || "",
    productType: record.productType || "",
    applicationArea: record.applicationArea || "",
    synonyms: normalizeList(record.synonyms).join("; "),
    competitorEquivalents: normalizeList(record.competitorEquivalents).join("; "),
    internalOwner: record.internalOwner || "",
    evidenceId: record.id || "",
    sourceType: record.sourceType || "publication",
    sourceTitle: record.sourceTitle || "",
    sourceUrl: record.sourceUrl || "",
    sourceId: record.sourceId || "",
    date: record.date || "",
    authors: normalizeList(record.authors).join("; "),
    institution: record.institution || "",
    country: record.country || "",
    contextLabel: record.contextLabel || "unclear",
    europePmcSentences: europePmcSentencesText(record),
    reviewStatus: record.reviewStatus || "candidate",
    connectorId: record.connectorId || DEFAULT_CONNECTOR_ID,
    confidenceScore: record.confidenceScore ?? "",
    productMentionType: record.productMentionType || "company_context",
    matchedText: mention.matchedText || record.matchedText || "",
    mentionConfidence: mention.confidence ?? record.mentionConfidence ?? "",
    competitors: normalizeList(record.competitors).join("; "),
    provenance: record.sourceUrl || record.sourceId || ""
  };
}

function companyCorpusRecord(row) {
  const context = clean(row.europePmcSentences || row.europe_pmc_sentences);
  const evidenceId = clean(row.evidenceId || row.id);
  const provenance = clean(row.provenance);
  const sourceUrl = clean(row.sourceUrl || row.source_url || (/^https?:\/\//i.test(provenance) ? provenance : ""));
  const sourceId = clean(row.sourceId || row.source_id || (sourceUrl ? "" : provenance));
  const sourceTitle = clean(row.sourceTitle || row.source_title || row.title);
  const connectorId = clean(row.connectorId || row.connector_id) || DEFAULT_CONNECTOR_ID;
  const productId = clean(row.productId || row.product_id);
  const productName = clean(row.productName || row.product_name);
  const matchedText = clean(row.matchedText || row.matched_text);
  const mentionConfidence = Number(row.mentionConfidence ?? row.mention_confidence);

  return {
    id: evidenceId || buildCorpusId(sourceId || sourceUrl || sourceTitle, context),
    sourceType: clean(row.sourceType || row.source_type) || "publication",
    sourceTitle,
    sourceUrl,
    sourceId,
    date: clean(row.date),
    authors: splitList(row.authors),
    institution: clean(row.institution),
    country: clean(row.country),
    contextLabel: clean(row.contextLabel || row.context_label) || "unclear",
    europePmcSentences: context,
    snippet: context || sourceTitle,
    reviewStatus: clean(row.reviewStatus || row.review_status) || "candidate",
    connectorId,
    confidenceScore: Number.isFinite(Number(row.confidenceScore ?? row.confidence_score))
      ? Number(row.confidenceScore ?? row.confidence_score)
      : 0.3,
    productMentionType: clean(row.productMentionType || row.product_mention_type) || "company_context",
    products: productId ? [{
      productId,
      productName,
      matchedText: matchedText || productName,
      mentionType: "manual",
      confidence: Number.isFinite(mentionConfidence) ? mentionConfidence : 0.95
    }] : [],
    competitorMentions: splitList(row.competitors).map((competitorName) => ({ competitorName })),
    rawPayload: {
      connectorId,
      sourceCorpus: sourceCorpusForConnector(connectorId),
      europePmcSentences: context
    }
  };
}

function companyCorpusProductCandidate(record, product, evidenceContext, now) {
  const sourceKey = record.sourceId || record.sourceUrl || record.sourceTitle || record.id;
  const matchedText = evidenceContext.matchedTerms[0] || product.catalogNumber || product.productName;
  const sourceLabel = sourceLabelForConnector(record.connectorId);
  const sourceCorpus = record.rawPayload?.sourceCorpus || sourceCorpusForConnector(record.connectorId);
  return {
    id: buildCandidateId(record.connectorId || DEFAULT_CONNECTOR_ID, product.id, sourceKey),
    connectorId: record.connectorId || DEFAULT_CONNECTOR_ID,
    sourceType: record.sourceType || "publication",
    sourceTitle: record.sourceTitle,
    sourceUrl: record.sourceUrl || undefined,
    sourceId: record.sourceId || undefined,
    date: record.date || now.toISOString().slice(0, 10),
    authors: record.authors || [],
    institution: record.institution || "",
    country: record.country || "",
    snippet: [
      `Saved ${sourceLabel} corpus context matched ${evidenceContext.matchedTerms.join(", ")} near GeneCopoeia.`,
      evidenceContext.text
    ].join(" "),
    europePmcSentences: evidenceContext.text,
    productMentionType: "connector_candidate",
    contextLabel: record.contextLabel || "unclear",
    confidenceScore: Math.min(Number(record.confidenceScore) || 0.3, 0.7),
    reviewStatus: "candidate",
    products: [{
      productId: product.id,
      productName: product.productName,
      matchedText,
      mentionType: mentionTypeForMatch(product, matchedText),
      confidence: 0.93
    }],
    competitorMentions: [],
    rawPayload: {
      ...(record.rawPayload || {}),
      connectorId: record.connectorId || DEFAULT_CONNECTOR_ID,
      productId: product.id,
      query: `local corpus relink ${product.catalogNumber || product.productName}`,
      sourceCorpus,
      sourceCorpusEvidenceId: record.id,
      europePmcSentences: evidenceContext.text,
      importedAt: now.toISOString()
    }
  };
}

function mentionTypeForMatch(product, matchedText) {
  const matched = compact(matchedText);
  if (matched && compact(product.catalogNumber) === matched) return "catalog_number";
  if (matched && compact(product.rrid) === matched) return "rrid";
  if (matched && normalize(product.productName) === normalize(matchedText)) return "product_name";
  if ((product.synonyms || []).some((synonym) => normalize(synonym) === normalize(matchedText))) return "synonym";
  return "manual";
}

function buildCandidateId(connectorId, productId, sourceKey) {
  return `AUTO-${connectorId.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${productId}-${hash(sourceKey)}`;
}

function buildCorpusId(sourceKey, context) {
  return `CORPUS-${hash(`${sourceKey}:${context}`)}`;
}

function sourceCorpusForConnector(connectorId = DEFAULT_CONNECTOR_ID) {
  if (connectorId === "pubmed_publications") return "local_pubmed_10y";
  if (connectorId === "biorxiv_preprints") return "local_biorxiv_10y";
  if (connectorId === "crossref_conferences") return "local_crossref_10y";
  return "local_europe_pmc_10y";
}

function sourceLabelForConnector(connectorId = DEFAULT_CONNECTOR_ID) {
  if (connectorId === "pubmed_publications") return "PubMed";
  if (connectorId === "biorxiv_preprints") return "bioRxiv";
  if (connectorId === "crossref_conferences") return "Crossref";
  return "Europe PMC";
}

function dedupeRecords(records) {
  return [...new Map(records.map((record) => [record.id, record])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || "").split(/[;|]/).map(clean).filter(Boolean);
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : splitList(value);
}

function csv(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hash(value) {
  let output = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    output = ((output << 5) - output + text.charCodeAt(index)) | 0;
  }
  return Math.abs(output).toString(36).toUpperCase();
}
