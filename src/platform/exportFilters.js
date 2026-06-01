export function resolveEvidenceExportFilters(products = [], params = {}) {
  const filters = {
    productId: param(params, "productId"),
    sourceType: param(params, "sourceType"),
    reviewStatus: param(params, "reviewStatus"),
    country: param(params, "country"),
    applicationArea: param(params, "applicationArea"),
    startDate: param(params, "startDate"),
    endDate: param(params, "endDate")
  };
  if (filters.productId) return filters;

  const catalogNumber = param(params, "catalogNumber");
  const productName = param(params, "productName");
  if (!catalogNumber && !productName) return filters;

  const product = products.find((item) => {
    const catalogMatches = !catalogNumber || normalize(item.catalogNumber) === normalize(catalogNumber);
    const nameMatches = !productName || normalize(item.productName) === normalize(productName);
    return catalogMatches && nameMatches;
  });

  return product ? { ...filters, productId: product.id } : filters;
}

function param(params, key) {
  const value = typeof params.get === "function" ? params.get(key) : params[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
