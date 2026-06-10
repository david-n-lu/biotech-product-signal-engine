import { evidenceForProduct } from "./evidenceFiltering.js";
import { hasEuropePmcCompanyContext } from "./europePmcSentences.js";

export function buildLocalWorkspaceSnapshot(state, now = new Date()) {
  const products = clone(state.products || []);
  const evidence = clone((state.evidence || []).filter(hasEuropePmcCompanyContext));
  const salesRecords = clone(state.salesRecords || []);
  const selectedProductId = clean(state.selectedProductId);

  return {
    version: 2,
    savedAt: now.toISOString(),
    selectedProductId,
    filters: clone(state.filters || {}),
    products,
    evidence,
    salesRecords,
    productDetails: buildProductDetails(products, evidence, salesRecords, selectedProductId, state.summary)
  };
}

export function buildProductDetails(products = [], evidence = [], salesRecords = [], selectedProductId = "", selectedSummary = null) {
  return Object.fromEntries((products || []).map((product) => {
    const productEvidence = evidenceForProduct(evidence, product);
    const productSales = salesRecords.filter((record) => record.productId === product.id);
    return [product.id, {
      product: clone(product),
      evidence: clone(productEvidence),
      salesRecords: clone(productSales),
      summary: product.id === selectedProductId ? clone(selectedSummary) : null,
      savedAt: new Date().toISOString()
    }];
  }));
}

export function resolveSavedSelectedProductId(saved, products = []) {
  const ids = new Set((products || []).map((product) => product.id));
  const selected = clean(saved?.selectedProductId);
  if (ids.has(selected)) return selected;
  const filtered = clean(saved?.filters?.productId);
  if (ids.has(filtered)) return filtered;
  return "";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}
