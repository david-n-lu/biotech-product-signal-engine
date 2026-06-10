import { europePmcSentencesText, hasEuropePmcCompanyContext, isEuropePmcRecord } from "./europePmcSentences.js";

export function evidenceForProduct(records = [], productOrId = "") {
  if (!productOrId) return [];
  return (records || []).filter((record) => {
    return evidenceMatchesProduct(record, productOrId);
  });
}

export function evidenceMatchesProduct(record, productOrId = "") {
  if (!hasEuropePmcCompanyContext(record)) return false;

  const product = normalizeProduct(productOrId);
  if (!product.id) return false;

  const mentions = (record?.products || []).filter((mention) => mention.productId === product.id);
  if (!mentions.length) return false;

  if (typeof productOrId === "string") return true;

  const terms = productIdentityTerms(product);
  if (!terms.length) return true;

  if (isEuropePmcRecord(record)) {
    const contextText = normalizeText(europePmcSentencesText(record));
    if (hasSameFamilyCatalogConflict(europePmcSentencesText(record), product)) return false;
    return terms.some((term) => includesNormalizedTerm(contextText, term));
  }

  const text = normalizeText([
    record.sourceTitle,
    record.sourceId,
    record.snippet,
    record.productMentionType,
    ...mentions.flatMap((mention) => [
      mention.matchedText,
      mention.mentionType
    ]),
    rawPayloadText(record.rawPayload)
  ].filter(Boolean).join(" "));

  return terms.some((term) => includesNormalizedTerm(text, term));
}

function normalizeProduct(productOrId) {
  if (typeof productOrId === "string") return { id: productOrId };
  return {
    id: clean(productOrId?.id),
    productName: clean(productOrId?.productName || productOrId?.product_name),
    catalogNumber: clean(productOrId?.catalogNumber || productOrId?.catalog_number),
    rrid: clean(productOrId?.rrid || productOrId?.RRID),
    synonyms: Array.isArray(productOrId?.synonyms) ? productOrId.synonyms : []
  };
}

function productIdentityTerms(product) {
  return unique([
    product.productName,
    product.catalogNumber,
    product.rrid,
    ...catalogTermsFromProductName(product.productName),
    ...(product.synonyms || [])
  ].map(clean).filter(Boolean));
}

function productCatalogTerms(product) {
  return unique([
    product.catalogNumber,
    product.rrid,
    ...catalogTermsFromProductName(product.productName),
    ...(product.synonyms || []).filter((term) => catalogLikeTerms(term).length)
  ].map(clean).filter(Boolean));
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

function rawPayloadText(value) {
  if (!value || typeof value !== "object") return "";
  return [
    value.query,
    value.productName,
    value.product_name,
    value.catalogNumber,
    value.catalog_number,
    value.rrid,
    value.rawPayload ? rawPayloadText(value.rawPayload) : ""
  ].map(clean).filter(Boolean).join(" ");
}

function includesNormalizedTerm(text, term) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  return text.includes(normalizedTerm);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values)];
}
