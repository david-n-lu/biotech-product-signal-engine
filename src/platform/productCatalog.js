import { parseCsv } from "./ingestion.js";

export function parseProductCatalogJson(text) {
  if (!String(text || "").trim()) {
    return { products: [], errors: ["Paste product catalog JSON before importing."] };
  }
  try {
    const parsed = JSON.parse(text);
    const products = Array.isArray(parsed) ? parsed : parsed.products || [parsed];
    return { products, errors: [] };
  } catch (error) {
    return { products: [], errors: [`Product catalog JSON could not be parsed: ${error.message}`] };
  }
}

export function parseProductCatalogCsv(text) {
  const parsed = parseCsv(text);
  if (parsed.errors.length) return { products: [], errors: parsed.errors };
  return { products: parsed.rows.map(normalizeProductCatalogRow), errors: [] };
}

function normalizeProductCatalogRow(row) {
  const productName = pick(row, ["productName", "product name", "name", "description"]);
  const description = pick(row, ["description"]);
  const catalogNumber = pick(row, [
    "catalogNumber",
    "catalog number",
    "catalog no",
    "cat no",
    "manufacturer sku",
    "part id",
    "sku"
  ]);
  const category = pick(row, ["productType", "product type", "category", "unspsc"]);
  const applicationArea = pick(row, ["applicationArea", "application area", "application", "research area"]);
  const synonyms = normalizeList(pick(row, ["synonyms", "synonym", "aliases"]));
  const legacyCatalog = extractLegacyCatalog(`${productName} ${description}`);
  if (legacyCatalog) synonyms.push(legacyCatalog);

  return {
    ...row,
    company: pick(row, ["company", "manufacturer", "brand"]) || "GeneCopoeia",
    productName,
    catalogNumber,
    rrid: pick(row, ["rrid", "RRID"]),
    productType: category || "catalog product",
    applicationArea: applicationArea || category || "catalog import",
    synonyms: unique(synonyms),
    competitorEquivalents: normalizeList(pick(row, ["competitorEquivalents", "competitor equivalents", "competitors"])),
    internalOwner: pick(row, ["internalOwner", "internal owner", "owner"]),
    productUrl: pick(row, ["productUrl", "product url", "url"]),
    datasheetUrl: pick(row, ["datasheetUrl", "datasheet url"]),
    size: pick(row, ["size"]),
    listPrice: pick(row, ["listPrice", "list price", "list price "]),
    leadTime: pick(row, ["leadTime", "lead time"]),
    shippingCondition: pick(row, ["shippingCondition", "shipping condition"]),
    storageCondition: pick(row, ["storageCondition", "storage condition"])
  };
}

function pick(row, names) {
  const byHeader = new Map(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), clean(value)]));
  for (const name of names) {
    const value = byHeader.get(normalizeHeader(name));
    if (value) return value;
  }
  return "";
}

function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (typeof value === "string") return value.split(/[;|]/).map(clean).filter(Boolean);
  return [];
}

function extractLegacyCatalog(value) {
  return clean(String(value || "").match(/\bOld Cat #\s*([A-Z0-9._-]+)/i)?.[1]);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\uFFFD/g, "").trim() : "";
}

export function productCatalogTemplate() {
  return JSON.stringify([
    {
      company: "GeneCopoeia",
      productName: "Product name from source catalog",
      catalogNumber: "CATALOG-001",
      rrid: "",
      productType: "reagent type",
      applicationArea: "application area",
      synonyms: ["source synonym"],
      competitorEquivalents: [],
      internalOwner: ""
    }
  ], null, 2);
}
