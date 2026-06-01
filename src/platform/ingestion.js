import { classifyCitationContext, normalizeContextLabel } from "./classifier.js";
import { matchCompetitors, matchProducts, searchProducts } from "./matching.js";

export const SOURCE_TYPES = [
  "publication",
  "patent",
  "trial",
  "grant",
  "protocol",
  "conference_abstract",
  "social_mention",
  "sales_record"
];

const SOURCE_ALIASES = new Map([
  ["publications", "publication"],
  ["paper", "publication"],
  ["papers", "publication"],
  ["article", "publication"],
  ["patents", "patent"],
  ["clinical_trial", "trial"],
  ["clinical trial", "trial"],
  ["clinical trials", "trial"],
  ["trials", "trial"],
  ["grants", "grant"],
  ["protocols", "protocol"],
  ["conference", "conference_abstract"],
  ["conference abstract", "conference_abstract"],
  ["abstract", "conference_abstract"],
  ["social", "social_mention"],
  ["social media", "social_mention"],
  ["mention", "social_mention"],
  ["sales", "sales_record"],
  ["sale", "sales_record"]
]);

export function importEvidenceFromJsonText(text, products) {
  if (!String(text || "").trim()) {
    return { records: [], errors: ["Paste JSON evidence before importing."] };
  }
  try {
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : parsed.evidence || [parsed];
    return normalizeEvidenceRecords(records, products);
  } catch (error) {
    return { records: [], errors: [`Evidence JSON could not be parsed: ${error.message}`] };
  }
}

export function importEvidenceFromCsvText(text, products) {
  if (!String(text || "").trim()) {
    return { records: [], errors: ["Paste CSV evidence before importing."] };
  }

  const parsed = parseCsv(text);
  if (parsed.errors.length) return { records: [], errors: parsed.errors };
  return normalizeEvidenceRecords(parsed.rows, products);
}

export function normalizeEvidenceRecords(rawRecords, products) {
  const records = [];
  const errors = [];
  const list = Array.isArray(rawRecords) ? rawRecords : [rawRecords];

  list.forEach((raw, index) => {
    const result = normalizeEvidenceRecord(raw, products, index);
    if (result.error) {
      errors.push(result.error);
      return;
    }
    records.push(result.record);
  });

  return { records, errors };
}

export function normalizeEvidenceRecord(raw, products, index = 0) {
  if (!isObject(raw)) return fail(index, "record must be an object");

  const sourceType = normalizeSourceType(raw.sourceType || raw.source_type || raw.type);
  const sourceTitle = clean(raw.sourceTitle || raw.source_title || raw.title || raw.source?.title);
  const sourceUrl = clean(raw.sourceUrl || raw.source_url || raw.url || raw.source?.url);
  const sourceId = clean(raw.sourceId || raw.source_id || raw.externalId || raw.source?.recordId);
  const date = normalizeDate(raw.date || raw.sourceDate || raw.source_date || raw.publishedAt || raw.source?.date);
  const snippet = clean(raw.snippet || raw.textSnippet || raw.text_snippet || raw.abstract || raw.text || raw.claim);
  const authors = normalizeList(raw.authors || raw.author || raw.source?.authors);
  const institution = clean(raw.institution || raw.account || raw.organization || raw.source?.institution);
  const lab = clean(raw.lab || raw.group || raw.source?.lab);
  const country = clean(raw.country || raw.source?.country);
  const diseaseAreas = normalizeList(raw.diseaseAreas || raw.disease_areas || raw.diseaseArea || raw.disease);
  const reviewStatus = normalizeReviewStatus(raw.reviewStatus || raw.review_status);

  if (!SOURCE_TYPES.includes(sourceType)) return fail(index, "sourceType is invalid or missing");
  if (!sourceTitle) return fail(index, "sourceTitle is required");
  if (!sourceUrl && !sourceId) return fail(index, "sourceUrl or sourceId is required");
  if (!snippet) return fail(index, "snippet is required");

  const rawConfidence = Number(raw.confidenceScore ?? raw.confidence_score ?? raw.confidence ?? 0.35);
  if (Number.isNaN(rawConfidence)) return fail(index, "confidenceScore must be numeric");

  const matchingText = [
    sourceTitle,
    snippet,
    raw.productName,
    raw.product_name,
    raw.product,
    raw.catalogNumber,
    raw.catalog_number,
    raw.rrid
  ].filter(Boolean).join(" ");

  const storedProductMatches = normalizeStoredProductMentions(raw.products, products);
  const explicitProduct = findExplicitProduct(raw, products);
  const inferredMatches = matchProducts(products, matchingText);
  const productMatches = storedProductMatches.length
    ? storedProductMatches
    : (explicitProduct
      ? [manualProductMatch(explicitProduct, raw)]
      : inferredMatches.filter((match) => match.confidence >= 0.58));
  const competitorMentions = matchCompetitors(products, matchingText);
  const classifier = classifyCitationContext(snippet);
  const contextLabel = normalizeContextLabel(raw.contextLabel || raw.context_label || classifier.label);
  const productMentionType = clean(raw.productMentionType || raw.product_mention_type)
    || productMatches[0]?.mentionType
    || (competitorMentions.length ? "competitor" : "unmatched");

  const confidenceScore = clamp01(reviewStatus === "curated"
    ? rawConfidence
    : Math.min(rawConfidence, sourceType === "social_mention" ? 0.55 : 0.7));

  const id = clean(raw.id) || buildEvidenceId({
    sourceType,
    sourceId,
    sourceTitle,
    date,
    snippet
  });

  return {
    record: {
      id,
      sourceType,
      sourceTitle,
      sourceUrl: sourceUrl || undefined,
      sourceId: sourceId || undefined,
      connectorId: clean(raw.connectorId || raw.connector_id) || undefined,
      date,
      authors,
      institution,
      lab,
      country,
      snippet,
      productMentionType,
      contextLabel,
      classifierConfidence: classifier.confidence,
      confidenceScore: round(confidenceScore),
      reviewStatus,
      products: productMatches.map((match) => ({
        productId: match.productId,
        productName: match.productName,
        matchedText: match.matchedText,
        mentionType: match.mentionType,
        confidence: round(match.confidence)
      })),
      competitorMentions: competitorMentions.map((match) => ({
        productId: match.productId,
        productName: match.productName,
        competitorName: match.competitorName,
        matchedText: match.matchedText,
        confidence: round(match.confidence)
      })),
      diseaseAreas,
      impactScore: Number.isFinite(Number(raw.impactScore ?? raw.impact_score))
        ? Number(raw.impactScore ?? raw.impact_score)
        : undefined,
      rawPayload: raw
    }
  };
}

export function normalizeSalesRecords(rawRecords, products) {
  const records = [];
  const errors = [];
  const list = Array.isArray(rawRecords) ? rawRecords : [rawRecords];

  list.forEach((raw, index) => {
    if (!isObject(raw)) {
      errors.push(`Sales record ${index + 1}: record must be an object.`);
      return;
    }

    const product = findExplicitProduct(raw, products)
      || searchProducts(raw.product || raw.productName || raw.catalogNumber || "", products)[0]?.product;
    const accountName = clean(raw.accountName || raw.account_name || raw.account || raw.institution);
    const date = normalizeDate(raw.date || raw.orderDate || raw.order_date);

    if (!product) {
      errors.push(`Sales record ${index + 1}: productId, catalogNumber, RRID, or product name must match a registry product.`);
      return;
    }
    if (!accountName) {
      errors.push(`Sales record ${index + 1}: accountName is required.`);
      return;
    }
    if (!date) {
      errors.push(`Sales record ${index + 1}: date is required.`);
      return;
    }

    records.push({
      id: clean(raw.id) || buildStableId("SALE", `${product.id}:${accountName}:${date}:${raw.revenue || 0}`),
      productId: product.id,
      accountName,
      institution: clean(raw.institution || accountName),
      country: clean(raw.country),
      date,
      units: Number.parseInt(String(raw.units ?? raw.quantity ?? 0), 10) || 0,
      revenue: Number(raw.revenue ?? raw.amount ?? 0) || 0,
      orderType: clean(raw.orderType || raw.order_type) || "order",
      sourceId: clean(raw.sourceId || raw.source_id)
    });
  });

  return { records, errors };
}

export function parseCsv(text) {
  const rows = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { rows, errors: ["CSV is empty."] };

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (headers.length === 0) return { rows, errors: ["CSV header row is required."] };

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index]);
    const row = {};
    headers.forEach((header, columnIndex) => {
      row[header] = values[columnIndex] ?? "";
    });
    rows.push(row);
  }

  return { rows, errors: [] };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function findExplicitProduct(raw, products) {
  const id = clean(raw.productId || raw.product_id);
  if (id) {
    const product = products.find((item) => item.id === id);
    if (product) return product;
  }

  for (const field of [raw.catalogNumber, raw.catalog_number, raw.rrid]) {
    const result = searchProducts(field, products)[0]?.product;
    if (result) return result;
  }

  return undefined;
}

function normalizeStoredProductMentions(mentions, products) {
  if (!Array.isArray(mentions)) return [];
  return mentions
    .map((mention) => {
      if (!isObject(mention)) return undefined;
      const product = products.find((item) => item.id === clean(mention.productId || mention.product_id));
      if (!product) return undefined;
      return {
        productId: product.id,
        productName: product.productName,
        matchedText: clean(mention.matchedText || mention.matched_text) || product.productName,
        mentionType: clean(mention.mentionType || mention.mention_type) || "manual",
        confidence: Number.isFinite(Number(mention.confidence)) ? Number(mention.confidence) : 0.95
      };
    })
    .filter(Boolean);
}

function manualProductMatch(product, raw) {
  return {
    productId: product.id,
    productName: product.productName,
    matchedText: clean(raw.productName || raw.product_name || raw.product || raw.catalogNumber || raw.catalog_number || raw.rrid) || product.productName,
    mentionType: "manual",
    confidence: 0.95
  };
}

function normalizeSourceType(value) {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  return SOURCE_ALIASES.get(normalized.replace(/_/g, " ")) || SOURCE_ALIASES.get(normalized) || normalized;
}

function normalizeReviewStatus(value) {
  const normalized = clean(value).toLowerCase();
  return ["candidate", "curated", "rejected"].includes(normalized) ? normalized : "candidate";
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[;|]/).map(clean).filter(Boolean);
  }
  return [];
}

function normalizeDate(value) {
  const raw = clean(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function buildEvidenceId(record) {
  return buildStableId(record.sourceType.toUpperCase(), [
    record.sourceId,
    record.sourceTitle,
    record.date,
    record.snippet
  ].filter(Boolean).join(":"));
}

function buildStableId(prefix, value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return `${prefix}-${Math.abs(hash).toString(36).toUpperCase()}`;
}

function fail(index, message) {
  return { error: `Evidence record ${index + 1}: ${message}.` };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
