export function evidenceForProduct(records = [], productOrId = "") {
  if (!productOrId) return [];
  return (records || []).filter((record) => {
    return evidenceMatchesProduct(record, productOrId);
  });
}

export function evidenceMatchesProduct(record, productOrId = "") {
  const product = normalizeProduct(productOrId);
  if (!product.id) return false;

  const mentions = (record?.products || []).filter((mention) => mention.productId === product.id);
  if (!mentions.length) return false;

  if (typeof productOrId === "string") return true;

  const terms = productIdentityTerms(product);
  if (!terms.length) return true;

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
    ...(product.synonyms || [])
  ].map(clean).filter(Boolean));
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
