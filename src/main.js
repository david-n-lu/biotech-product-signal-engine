import { getEvidenceSourceLink } from "./platform/evidenceLinks.js";
import { evidenceForProduct } from "./platform/evidenceFiltering.js";
import { evidenceTableHeaders } from "./platform/evidenceTableColumns.js";
import { buildLocalWorkspaceSnapshot, resolveSavedSelectedProductId } from "./platform/localWorkspace.js";
import { pageIndexForItem, paginateItems } from "./platform/pagination.js";

const LOCAL_WORKSPACE_KEY = "genecopoeiaSignalEngine.workspace.v1";
const PRODUCT_PAGE_SIZE = 8;
const PUBLICATION_CONNECTOR_IDS = [
  "pubmed_publications",
  "europepmc_fulltext_publications",
  "biorxiv_preprints"
];

const state = {
  products: [],
  evidence: [],
  visibleEvidence: [],
  salesRecords: [],
  connectors: [],
  connectorRuns: [],
  analytics: null,
  leads: [],
  alerts: [],
  selectedProductId: "",
  productPageIndex: 0,
  summary: null,
  filters: {}
};

const elements = {
  loadDemo: document.querySelector("#loadDemo"),
  resetData: document.querySelector("#resetData"),
  exportCsv: document.querySelector("#exportCsv"),
  runConnectors: document.querySelector("#runConnectors"),
  connectorList: document.querySelector("#connectorList"),
  productSearch: document.querySelector("#productSearch"),
  productResults: document.querySelector("#productResults"),
  productPageInfo: document.querySelector("#productPageInfo"),
  prevProductPage: document.querySelector("#prevProductPage"),
  nextProductPage: document.querySelector("#nextProductPage"),
  productCatalogForm: document.querySelector("#productCatalogForm"),
  productCatalogFormat: document.querySelector("#productCatalogFormat"),
  productCatalogPayload: document.querySelector("#productCatalogPayload"),
  productForm: document.querySelector("#productForm"),
  productId: document.querySelector("#productId"),
  productCompany: document.querySelector("#productCompany"),
  productName: document.querySelector("#productName"),
  catalogNumber: document.querySelector("#catalogNumber"),
  rrid: document.querySelector("#rrid"),
  productType: document.querySelector("#productType"),
  applicationArea: document.querySelector("#applicationArea"),
  synonyms: document.querySelector("#synonyms"),
  competitors: document.querySelector("#competitors"),
  internalOwner: document.querySelector("#internalOwner"),
  newProduct: document.querySelector("#newProduct"),
  deleteProduct: document.querySelector("#deleteProduct"),
  filterForm: document.querySelector("#filterForm"),
  filterProduct: document.querySelector("#filterProduct"),
  filterSource: document.querySelector("#filterSource"),
  filterReview: document.querySelector("#filterReview"),
  filterApplication: document.querySelector("#filterApplication"),
  filterCountry: document.querySelector("#filterCountry"),
  filterStart: document.querySelector("#filterStart"),
  filterEnd: document.querySelector("#filterEnd"),
  clearFilters: document.querySelector("#clearFilters"),
  ingestForm: document.querySelector("#ingestForm"),
  ingestFormat: document.querySelector("#ingestFormat"),
  ingestPayload: document.querySelector("#ingestPayload"),
  message: document.querySelector("#message"),
  kpiProducts: document.querySelector("#kpiProducts"),
  kpiMentions: document.querySelector("#kpiMentions"),
  kpiRevenue: document.querySelector("#kpiRevenue"),
  kpiRepeat: document.querySelector("#kpiRepeat"),
  kpiConfidence: document.querySelector("#kpiConfidence"),
  sourceChart: document.querySelector("#sourceChart"),
  timeChart: document.querySelector("#timeChart"),
  institutionList: document.querySelector("#institutionList"),
  authorList: document.querySelector("#authorList"),
  performanceCount: document.querySelector("#performanceCount"),
  performanceTable: document.querySelector("#performanceTable"),
  detailTitle: document.querySelector("#detailTitle"),
  detailProduct: document.querySelector("#detailProduct"),
  runSelectedProduct: document.querySelector("#runSelectedProduct"),
  runDeepPublicationSearch: document.querySelector("#runDeepPublicationSearch"),
  productSummary: document.querySelector("#productSummary"),
  productEvidence: document.querySelector("#productEvidence"),
  evidenceCount: document.querySelector("#evidenceCount"),
  evidenceTable: document.querySelector("#evidenceTable"),
  leadCount: document.querySelector("#leadCount"),
  leads: document.querySelector("#leads"),
  shareOfVoice: document.querySelector("#shareOfVoice"),
  citationRevenue: document.querySelector("#citationRevenue"),
  alertCount: document.querySelector("#alertCount"),
  alerts: document.querySelector("#alerts")
};

initialize();

async function initialize() {
  bindEvents();
  await restoreLocalWorkspace();
  await refreshAll();
}

function bindEvents() {
  elements.loadDemo.addEventListener("click", async () => {
    await postJson("/api/demo/load", {});
    setMessage("Synthetic demo data loaded.", "success");
    await refreshAll();
  });

  elements.resetData.addEventListener("click", async () => {
    if (!confirm("Reset all in-memory prototype data?")) return;
    await postJson("/api/demo/reset", {});
    state.selectedProductId = "";
    clearProductForm();
    setMessage("Prototype data reset.", "success");
    await refreshAll();
  });

  elements.runConnectors.addEventListener("click", runAllConnectors);
  elements.productSearch.addEventListener("input", () => {
    state.productPageIndex = 0;
    renderProductResults();
  });
  elements.productSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const product = filteredProductsForSearch()[0];
    if (product) selectProduct(product);
  });
  elements.prevProductPage.addEventListener("click", () => changeProductPage(-1));
  elements.nextProductPage.addEventListener("click", () => changeProductPage(1));
  elements.productCatalogForm.addEventListener("submit", importProductCatalog);
  elements.newProduct.addEventListener("click", clearProductForm);
  elements.productForm.addEventListener("submit", saveProduct);
  elements.deleteProduct.addEventListener("click", deleteSelectedProduct);
  elements.runSelectedProduct.addEventListener("click", runSelectedProductSearch);
  elements.runDeepPublicationSearch.addEventListener("click", runDeepPublicationSearch);
  elements.filterForm.addEventListener("submit", applyFilters);
  elements.clearFilters.addEventListener("click", clearFilters);
  elements.ingestForm.addEventListener("submit", ingestEvidence);
  elements.detailProduct.addEventListener("change", async () => {
    const product = state.products.find((item) => item.id === elements.detailProduct.value);
    if (product) await selectProduct(product);
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`#${tab.dataset.view}`).classList.add("active");
    });
  });
}

async function refreshAll() {
  const snapshot = await fetchJson("/api/state");
  state.products = snapshot.products || [];
  state.evidence = snapshot.evidence || [];
  state.salesRecords = snapshot.salesRecords || [];
  if (state.selectedProductId && !state.products.some((product) => product.id === state.selectedProductId)) {
    state.selectedProductId = "";
    state.filters.productId = "";
  }
  if (state.filters.productId && !state.products.some((product) => product.id === state.filters.productId)) {
    state.filters.productId = "";
  }

  const query = filterQuery();
  const [analytics, leadsResult, alertsResult, connectorsResult, evidenceResult] = await Promise.all([
    fetchJson(`/api/analytics${query}`),
    fetchJson(`/api/leads${query}`),
    fetchJson("/api/alerts"),
    fetchJson("/api/connectors"),
    fetchJson(`/api/evidence${query}`)
  ]);

  state.analytics = analytics;
  state.leads = leadsResult.leads || [];
  state.alerts = alertsResult.alerts || [];
  state.connectors = connectorsResult.connectors || [];
  state.connectorRuns = connectorsResult.runs || [];
  state.visibleEvidence = evidenceResult.evidence || state.evidence;
  await refreshProductSummary();
  render();
  persistLocalWorkspace();
}

async function refreshProductSummary() {
  state.summary = state.selectedProductId
    ? await fetchJson(`/api/products/${encodeURIComponent(state.selectedProductId)}/summary`)
    : null;
}

function render() {
  renderKpis();
  renderSelects();
  renderExportLinks();
  renderProductResults();
  renderConnectors();
  renderOverview();
  renderProductDetail();
  renderEvidenceExplorer();
  renderLeads();
  renderCompetitors();
  renderAlerts();
}

function renderExportLinks() {
  elements.exportCsv.href = csvExportHref();
}

function csvExportHref() {
  const params = new URLSearchParams();
  const product = selectedProduct();
  for (const [key, value] of Object.entries(effectiveFilters())) {
    if (value) params.set(key, value);
  }
  if (product) {
    if (product.catalogNumber) params.set("catalogNumber", product.catalogNumber);
    if (product.productName) params.set("productName", product.productName);
  }
  const query = params.toString();
  return `/api/export/evidence.csv${query ? `?${query}` : ""}`;
}

function renderKpis() {
  const overview = state.analytics?.overview;
  elements.kpiProducts.textContent = overview?.totalProducts.value ?? 0;
  elements.kpiMentions.textContent = overview?.totalMentions.value ?? 0;
  elements.kpiRevenue.textContent = money(overview?.totalRevenue.value ?? 0);
  elements.kpiRepeat.textContent = percent(overview?.repeatPurchaseRate.value ?? 0);
  elements.kpiConfidence.textContent = percent(overview?.averageConfidence.value ?? 0);
}

function renderSelects() {
  fillProductSelect(elements.filterProduct, "All products", activeProductId());
  fillProductSelect(elements.detailProduct, "Select product", state.selectedProductId);
}

function fillProductSelect(select, emptyLabel, value) {
  const previous = value || select.value;
  select.replaceChildren(option("", emptyLabel));
  for (const product of state.products) {
    select.append(option(product.id, product.productName));
  }
  select.value = previous;
}

function renderProductResults() {
  const products = filteredProductsForSearch();
  const page = paginateItems(products, state.productPageIndex, PRODUCT_PAGE_SIZE);
  state.productPageIndex = page.pageIndex;

  elements.productResults.replaceChildren();
  if (products.length === 0) {
    elements.productResults.append(emptyNode("No products."));
    renderProductPager(page);
    return;
  }

  for (const product of page.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = product.id === state.selectedProductId ? "result-row selected" : "result-row";
    button.append(
      element("strong", product.productName),
      element("span", [product.catalogNumber, product.rrid, product.applicationArea].filter(Boolean).join(" | "))
    );
    button.addEventListener("click", () => selectProduct(product));
    elements.productResults.append(button);
  }
  renderProductPager(page);
}

function renderProductPager(page) {
  const first = page.totalItems ? page.start + 1 : 0;
  elements.productPageInfo.textContent = `${first}-${page.end} of ${page.totalItems} | Page ${page.pageIndex + 1} of ${page.totalPages}`;
  elements.prevProductPage.disabled = !page.canGoPrevious;
  elements.nextProductPage.disabled = !page.canGoNext;
}

function changeProductPage(delta) {
  state.productPageIndex += delta;
  renderProductResults();
  elements.productResults.scrollTop = 0;
}

function filteredProductsForSearch() {
  const query = elements.productSearch.value.trim().toLowerCase();
  return state.products.filter((product) => {
    const text = [
      product.company,
      product.productName,
      product.catalogNumber,
      product.rrid,
      product.productType,
      product.applicationArea,
      ...(product.synonyms || [])
    ].join(" ").toLowerCase();
    return !query || text.includes(query);
  });
}

async function selectProduct(product) {
  state.selectedProductId = product.id;
  state.filters.productId = product.id;
  state.productPageIndex = pageIndexForItem(filteredProductsForSearch(), product.id, PRODUCT_PAGE_SIZE);
  populateProductForm(product);
  elements.detailProduct.value = product.id;
  elements.filterProduct.value = product.id;
  persistLocalWorkspace();
  await refreshAll();
}

function renderOverview() {
  renderBars(elements.sourceChart, state.analytics?.mentionsBySourceType || [], "count");
  renderBars(elements.timeChart, state.analytics?.mentionsOverTime || [], "count");
  renderRankList(elements.institutionList, state.analytics?.topInstitutions || []);
  renderRankList(elements.authorList, state.analytics?.topAuthors || []);
  const rows = state.analytics?.productPerformance || [];
  elements.performanceCount.textContent = `${rows.length} product${rows.length === 1 ? "" : "s"}`;
  elements.performanceTable.replaceChildren(table([
    "Product",
    "Application",
    "Mentions",
    "Institutions",
    "Revenue",
    "Confidence",
    "Provenance"
  ], rows.map((row) => [
    row.productName,
    row.applicationArea,
    row.mentions,
    row.institutions,
    money(row.revenue),
    percent(row.averageConfidence),
    provenance(row.provenanceIds, row.salesRecordIds)
  ])));
}

function renderConnectors() {
  elements.connectorList.replaceChildren();
  if (!state.connectors.length) {
    elements.connectorList.append(emptyNode("No connectors configured."));
    return;
  }

  for (const connector of state.connectors) {
    const item = document.createElement("article");
    item.className = connector.enabled ? "connector-card" : "connector-card disabled";
    const header = document.createElement("div");
    header.className = "connector-header";
    header.append(
      element("strong", connector.name),
      element("span", connector.enabled ? "Scheduled" : "Disabled")
    );
    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "ghost";
    runButton.textContent = "Run";
    runButton.disabled = !connector.enabled;
    runButton.addEventListener("click", () => runConnector(connector.id));
    item.append(
      header,
      element("p", connector.description),
      metricRow([
        ["Source", sourceLabel(connector.sourceType)],
        ["Every", `${connector.intervalMinutes} min`],
        ["Last", connector.lastRunAt ? connector.lastStatus : "never"],
        ["Imported", connector.lastImported ?? 0]
      ]),
      runButton
    );
    if (connector.documentationUrl) {
      const link = document.createElement("a");
      link.href = connector.documentationUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.className = "connector-link";
      link.textContent = "RESTful Web Service docs";
      item.append(link);
    }
    if (connector.lastErrors?.length) {
      item.append(element("p", connector.lastErrors.slice(0, 1).join(" "), "connector-error"));
    }
    if (connector.lastNotices?.length) {
      item.append(element("p", connector.lastNotices.slice(0, 1).join(" "), "connector-notice"));
    }
    elements.connectorList.append(item);
  }
}

function renderProductDetail() {
  const product = selectedProduct();
  elements.detailTitle.textContent = product ? product.productName : "Product detail";
  if (product && elements.productId.value !== product.id) populateProductForm(product);

  elements.productSummary.replaceChildren();
  if (!state.summary) {
    elements.productSummary.append(emptyNode("No selected product."));
  } else {
    for (const section of state.summary.sections || []) {
      const article = document.createElement("article");
      article.className = "summary-item";
      article.append(element("h3", section.title), element("p", section.text));
      elements.productSummary.append(article);
    }
  }

  const productEvidence = evidenceForProduct(state.evidence, product);
  renderEvidenceTable(elements.productEvidence, productEvidence.slice(0, 8));
}

function renderEvidenceExplorer() {
  const product = selectedProduct();
  const records = evidenceForProduct(state.visibleEvidence, product);
  elements.evidenceCount.textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;
  renderEvidenceTable(elements.evidenceTable, records);
}

function renderEvidenceTable(container, records) {
  container.replaceChildren(table(evidenceTableHeaders(), records.map((record) => [
    sourceCell(record),
    record.date || "",
    record.institution || "",
    (record.products || []).map((mention) => mention.productName).join(", ") || "Unmatched",
    record.contextLabel,
    reviewBadge(record.reviewStatus),
    percent(record.confidenceScore),
    reviewActions(record),
    provenance([record.id])
  ])));
}

function sourceCell(record) {
  const link = getEvidenceSourceLink(record);
  if (!link.href) return element("span", link.label);

  const anchor = document.createElement("a");
  anchor.href = link.href;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.className = link.isEuropePmc ? "source-link europe-pmc-link" : "source-link";
  anchor.textContent = link.label;
  return anchor;
}

function renderLeads() {
  elements.leadCount.textContent = `${state.leads.length} lead${state.leads.length === 1 ? "" : "s"}`;
  elements.leads.replaceChildren();
  if (state.leads.length === 0) {
    elements.leads.append(emptyNode("No leads."));
    return;
  }

  for (const lead of state.leads) {
    const article = document.createElement("article");
    article.className = "lead-card";
    article.append(
      element("h3", `${lead.institution} -> ${lead.productName}`),
      element("p", lead.recommendedAction),
      metricRow([
        ["Lead score", lead.score],
        ["Confidence", percent(lead.confidence)]
      ])
    );
    const features = document.createElement("div");
    features.className = "feature-list";
    for (const feature of lead.topContributingFeatures.slice(0, 4)) {
      features.append(element("span", `${feature.label}: +${feature.points}`));
    }
    article.append(features, provenanceBlock(lead.evidenceIds, lead.salesRecordIds));
    elements.leads.append(article);
  }
}

function renderCompetitors() {
  renderBars(elements.shareOfVoice, state.analytics?.shareOfVoice || [], "share", true);
  const rows = state.analytics?.citationToRevenue || [];
  elements.citationRevenue.replaceChildren(table([
    "Product",
    "Citations",
    "Revenue",
    "Citations per $1K",
    "Provenance"
  ], rows.map((row) => [
    row.productName,
    row.citations,
    money(row.revenue),
    number(row.value),
    provenance(row.provenanceIds, row.salesRecordIds)
  ])));
}

function renderAlerts() {
  elements.alertCount.textContent = `${state.alerts.length} alert${state.alerts.length === 1 ? "" : "s"}`;
  elements.alerts.replaceChildren();
  if (state.alerts.length === 0) {
    elements.alerts.append(emptyNode("No alerts."));
    return;
  }
  for (const alert of state.alerts) {
    const article = document.createElement("article");
    article.className = `alert-card ${alert.severity}`;
    article.append(
      element("h3", alert.title),
      element("p", alert.explanation),
      metricRow([
        ["Severity", alert.severity],
        ["Confidence", percent(alert.confidence)]
      ]),
      provenanceBlock(alert.evidenceIds, alert.salesRecordIds)
    );
    elements.alerts.append(article);
  }
}

async function saveProduct(event) {
  event.preventDefault();
  const payload = readProductForm();
  const id = elements.productId.value;
  const result = id
    ? await fetchJson(`/api/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) })
    : await postJson("/api/products", payload);
  state.selectedProductId = result.product.id;
  state.filters.productId = result.product.id;
  setMessage("Product saved.", "success");
  await refreshAll();
}

async function runAllConnectors() {
  elements.runConnectors.disabled = true;
  setMessage("Running source connectors. Imported records will remain candidate evidence until reviewed.", "");
  try {
    const run = await postJson("/api/connectors/run", {});
    const detail = run.errors?.length ? ` ${run.errors.slice(0, 2).join(" ")}` : "";
    setMessage(`Connector run imported ${run.imported} candidate record${run.imported === 1 ? "" : "s"}.${detail}`, run.errors?.length ? "error" : "success");
    await refreshAll();
  } finally {
    elements.runConnectors.disabled = false;
  }
}

async function runSelectedProductSearch() {
  if (!state.selectedProductId) {
    setMessage("Select a product before running evidence search.", "error");
    return;
  }
  elements.runSelectedProduct.disabled = true;
  setMessage("Searching enabled sources for the selected product. Imported records remain candidates until reviewed.", "");
  try {
    const run = await postJson("/api/connectors/run", {
      productIds: [state.selectedProductId]
    });
    const detail = run.errors?.length
      ? ` ${run.errors.slice(0, 2).join(" ")}`
      : run.notices?.length
        ? ` ${run.notices.slice(0, 2).join(" ")}`
        : "";
    setMessage(`Selected-product search imported ${run.imported} candidate record${run.imported === 1 ? "" : "s"}.${detail}`, run.errors?.length ? "error" : "success");
    await refreshAll();
  } finally {
    elements.runSelectedProduct.disabled = false;
  }
}

async function runDeepPublicationSearch() {
  if (!state.selectedProductId) {
    setMessage("Select a product before running deep publication search.", "error");
    return;
  }
  elements.runSelectedProduct.disabled = true;
  elements.runDeepPublicationSearch.disabled = true;
  setMessage("Running deep publication search for the selected product. Imported hits remain low-confidence candidates until reviewed.", "");
  try {
    const run = await postJson("/api/connectors/run", {
      connectorIds: PUBLICATION_CONNECTOR_IDS,
      productIds: [state.selectedProductId],
      searchMode: "deep",
      perProductLimit: 10
    });
    const detail = run.errors?.length
      ? ` ${run.errors.slice(0, 2).join(" ")}`
      : run.notices?.length
        ? ` ${run.notices.slice(0, 2).join(" ")}`
        : "";
    setMessage(`Deep publication search imported ${run.imported} candidate record${run.imported === 1 ? "" : "s"}.${detail}`, run.errors?.length ? "error" : "success");
    await refreshAll();
  } finally {
    elements.runSelectedProduct.disabled = false;
    elements.runDeepPublicationSearch.disabled = false;
  }
}

async function runConnector(connectorId) {
  setMessage("Running connector. Imported records will remain candidate evidence until reviewed.", "");
  const run = await postJson(`/api/connectors/${encodeURIComponent(connectorId)}/run`, {});
  const detail = run.errors?.length ? ` ${run.errors.slice(0, 2).join(" ")}` : "";
  setMessage(`Connector imported ${run.imported} candidate record${run.imported === 1 ? "" : "s"}.${detail}`, run.errors?.length ? "error" : "success");
  await refreshAll();
}

async function importProductCatalog(event) {
  event.preventDefault();
  const format = elements.productCatalogFormat.value;
  const payload = elements.productCatalogPayload.value;
  if (!payload.trim()) {
    setMessage("Paste a GeneCopoeia product catalog JSON or CSV before importing.", "error");
    return;
  }
  const response = await fetchJson("/api/products/import", {
    method: "POST",
    headers: format === "csv" ? { "Content-Type": "text/csv" } : { "Content-Type": "application/json" },
    body: payload
  });
  const detail = response.errors?.length ? ` ${response.errors.join(" ")}` : "";
  if (response.products?.[0]) {
    state.selectedProductId = response.products[0].id;
    state.filters.productId = response.products[0].id;
    state.productPageIndex = pageIndexForItem(filteredProductsForSearch(), response.products[0].id, PRODUCT_PAGE_SIZE);
  }
  setMessage(`Imported ${response.imported} product${response.imported === 1 ? "" : "s"} into local registry.${detail}`, response.errors?.length ? "error" : "success");
  if (!response.errors?.length) elements.productCatalogPayload.value = "";
  await refreshAll();
}

async function reviewEvidence(id, reviewStatus) {
  await fetchJson(`/api/evidence/${encodeURIComponent(id)}/review`, {
    method: "PUT",
    body: JSON.stringify({ reviewStatus })
  });
  setMessage(`Evidence ${id} marked ${reviewStatus}.`, "success");
  await refreshAll();
}

async function deleteSelectedProduct() {
  const id = elements.productId.value || state.selectedProductId;
  if (!id) return;
  if (!confirm("Delete this product and its matched sales records?")) return;
  await fetchJson(`/api/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.selectedProductId = "";
  clearProductForm();
  setMessage("Product deleted.", "success");
  await refreshAll();
}

function applyFilters(event) {
  event.preventDefault();
  const productId = elements.filterProduct.value;
  state.filters = {
    productId,
    sourceType: elements.filterSource.value,
    reviewStatus: elements.filterReview.value,
    applicationArea: elements.filterApplication.value.trim(),
    country: elements.filterCountry.value.trim(),
    startDate: elements.filterStart.value,
    endDate: elements.filterEnd.value
  };
  if (productId) {
    const product = state.products.find((item) => item.id === productId);
    if (product) {
      state.selectedProductId = productId;
      populateProductForm(product);
    }
  }
  refreshAll();
}

function clearFilters() {
  state.filters = state.selectedProductId ? { productId: state.selectedProductId } : {};
  elements.filterForm.reset();
  refreshAll();
}

async function ingestEvidence(event) {
  event.preventDefault();
  const format = elements.ingestFormat.value;
  const payload = elements.ingestPayload.value;
  const route = format === "csv" ? "/api/ingest/csv" : format === "api" ? "/api/ingest/api" : "/api/ingest/json";
  const response = await fetchJson(route, {
    method: "POST",
    headers: format === "csv" ? { "Content-Type": "text/csv" } : { "Content-Type": "application/json" },
    body: format === "csv" ? payload : payload
  });
  const detail = response.errors?.length ? ` ${response.errors.join(" ")}` : "";
  setMessage(`Imported ${response.imported} evidence record${response.imported === 1 ? "" : "s"}.${detail}`, response.errors?.length ? "error" : "success");
  if (!response.errors?.length) elements.ingestPayload.value = "";
  await refreshAll();
}

function populateProductForm(product) {
  if (!product) return;
  elements.productId.value = product.id;
  elements.productCompany.value = product.company || "GeneCopoeia";
  elements.productName.value = product.productName || "";
  elements.catalogNumber.value = product.catalogNumber || "";
  elements.rrid.value = product.rrid || "";
  elements.productType.value = product.productType || "";
  elements.applicationArea.value = product.applicationArea || "";
  elements.synonyms.value = (product.synonyms || []).join("; ");
  elements.competitors.value = (product.competitorEquivalents || []).join("; ");
  elements.internalOwner.value = product.internalOwner || "";
}

function clearProductForm() {
  elements.productForm.reset();
  elements.productId.value = "";
  elements.productCompany.value = "GeneCopoeia";
}

function readProductForm() {
  return {
    company: elements.productCompany.value,
    productName: elements.productName.value,
    catalogNumber: elements.catalogNumber.value,
    rrid: elements.rrid.value,
    productType: elements.productType.value,
    applicationArea: elements.applicationArea.value,
    synonyms: splitList(elements.synonyms.value),
    competitorEquivalents: splitList(elements.competitors.value),
    internalOwner: elements.internalOwner.value
  };
}

function filterQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(effectiveFilters())) {
    if (value) params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function activeProductId() {
  return state.filters.productId || state.selectedProductId || "";
}

function selectedProduct() {
  const productId = activeProductId();
  return state.products.find((item) => item.id === productId);
}

function effectiveFilters() {
  return {
    ...state.filters,
    productId: activeProductId()
  };
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function restoreLocalWorkspace() {
  const saved = readLocalWorkspace();
  if (!saved) return;
  const serverState = await fetchJson("/api/state");
  const productsForSelection = hasWorkspaceRecords(serverState) ? serverState.products : saved.products;
  const selectedProductId = resolveSavedSelectedProductId(saved, productsForSelection);
  if (selectedProductId) {
    state.selectedProductId = selectedProductId;
    state.filters.productId = selectedProductId;
  }
  if (!hasWorkspaceRecords(saved) || hasWorkspaceRecords(serverState)) return;
  await postJson("/api/state/restore", saved);
  setMessage("Restored locally saved GeneCopoeia workspace.", "success");
}

function persistLocalWorkspace() {
  try {
    const snapshot = buildLocalWorkspaceSnapshot(state);
    localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(snapshot));
  } catch {
    setMessage("Local browser storage is unavailable; workspace will persist only while the server is running.", "error");
  }
}

function readLocalWorkspace() {
  try {
    const raw = localStorage.getItem(LOCAL_WORKSPACE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hasWorkspaceRecords(snapshot) {
  return Boolean(snapshot?.products?.length || snapshot?.evidence?.length || snapshot?.salesRecords?.length);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function renderBars(container, rows, valueKey, isPercent = false) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(emptyNode("No records."));
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row[valueKey]) || 0), 1);
  for (const row of rows) {
    const value = Number(row[valueKey]) || 0;
    const item = document.createElement("div");
    item.className = "bar-row";
    item.append(
      element("span", row.label),
      element("strong", isPercent ? percent(value) : String(row.count ?? value))
    );
    const bar = document.createElement("i");
    bar.style.width = `${Math.max(4, (value / max) * 100)}%`;
    item.append(bar, provenanceBlock(row.provenanceIds || []));
    container.append(item);
  }
}

function renderRankList(container, rows) {
  container.replaceChildren();
  if (!rows.length) {
    container.append(emptyNode("No records."));
    return;
  }
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "rank-row";
    item.append(
      element("strong", row.label),
      element("span", `${row.count} mention${row.count === 1 ? "" : "s"} | ${percent(row.confidence)}`),
      provenanceBlock(row.provenanceIds)
    );
    container.append(item);
  }
}

function table(headers, rows) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroller";
  const tableNode = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach((header) => headRow.append(element("th", header)));
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = element("td", "No records.");
    cell.colSpan = headers.length;
    row.append(cell);
    tbody.append(row);
  } else {
    for (const rowValues of rows) {
      const row = document.createElement("tr");
      for (const value of rowValues) {
        const cell = document.createElement("td");
        if (value instanceof Node) {
          cell.append(value);
        } else {
          cell.textContent = value;
        }
        row.append(cell);
      }
      tbody.append(row);
    }
  }
  tableNode.append(thead, tbody);
  wrapper.append(tableNode);
  return wrapper;
}

function reviewBadge(status) {
  const node = document.createElement("span");
  node.className = `review-badge ${status || "candidate"}`;
  node.textContent = status === "curated" ? "Curated proof" : status || "candidate";
  return node;
}

function reviewActions(record) {
  const row = document.createElement("div");
  row.className = "action-row";
  if (record.reviewStatus !== "curated") {
    const curate = document.createElement("button");
    curate.type = "button";
    curate.className = "secondary";
    curate.textContent = "Curate";
    curate.addEventListener("click", () => reviewEvidence(record.id, "curated"));
    row.append(curate);
  }
  if (record.reviewStatus !== "rejected") {
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "ghost";
    reject.textContent = "Reject";
    reject.addEventListener("click", () => reviewEvidence(record.id, "rejected"));
    row.append(reject);
  }
  if (!row.childNodes.length) row.append(element("span", "Reviewed"));
  return row;
}

function provenanceBlock(evidenceIds = [], salesRecordIds = []) {
  const block = document.createElement("div");
  block.className = "provenance";
  const ids = [...(evidenceIds || []), ...(salesRecordIds || [])].filter(Boolean).slice(0, 8);
  if (!ids.length) {
    block.append(element("code", "No provenance"));
    return block;
  }
  ids.forEach((id) => block.append(element("code", id)));
  return block;
}

function provenance(evidenceIds = [], salesRecordIds = []) {
  return provenanceBlock(evidenceIds, salesRecordIds);
}

function metricRow(items) {
  const row = document.createElement("div");
  row.className = "metric-row";
  for (const [label, value] of items) {
    const pill = document.createElement("span");
    pill.textContent = `${label}: ${value}`;
    row.append(pill);
  }
  return row;
}

function emptyNode(message) {
  const node = document.createElement("p");
  node.className = "empty";
  node.textContent = message;
  return node;
}

function element(tagName, text, className = "") {
  const node = document.createElement(tagName);
  node.textContent = text ?? "";
  if (className) node.className = className;
  return node;
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function splitList(value) {
  return String(value || "").split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function sourceLabel(value) {
  return String(value || "").replace(/_/g, " ");
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function number(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function setMessage(message, kind = "") {
  elements.message.textContent = message;
  elements.message.className = `message ${kind}`.trim();
}
