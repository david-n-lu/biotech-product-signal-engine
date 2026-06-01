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
  return { products: parsed.rows, errors: [] };
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
