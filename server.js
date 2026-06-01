import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConnectorScheduler } from "./src/platform/connectorScheduler.js";
import { evaluateAlerts } from "./src/platform/alerts.js";
import { buildAnalytics, filterEvidence } from "./src/platform/analytics.js";
import {
  buildPdfReadyReport,
  exportEvidenceCsv,
  exportEvidenceFilename,
  exportProductEvidenceCsv,
  exportProductsCsv
} from "./src/platform/reporting.js";
import { scoreLeads } from "./src/platform/leadScoring.js";
import { buildProductSummary } from "./src/platform/summaries.js";
import { parseProductCatalogCsv, parseProductCatalogJson } from "./src/platform/productCatalog.js";
import { resolveEvidenceExportFilters } from "./src/platform/exportFilters.js";
import { createRepository } from "./src/platform/store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 4173);
const repository = createRepository();
const connectorScheduler = createConnectorScheduler(repository);
connectorScheduler.start();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Unexpected server error"
    });
  }
});

server.listen(PORT, () => {
  console.log(`Genecopoeia analytics prototype running at http://localhost:${PORT}`);
});

async function handleApi(request, response, url) {
  const { pathname } = url;
  const method = request.method || "GET";

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "genecopoeia-signal-engine" });
    return;
  }

  if (method === "GET" && pathname === "/api/state") {
    sendJson(response, 200, repository.snapshot());
    return;
  }

  if (method === "POST" && pathname === "/api/state/restore") {
    sendJson(response, 200, repository.restoreSnapshot(await readJson(request)));
    return;
  }

  if (method === "POST" && pathname === "/api/demo/load") {
    sendJson(response, 200, repository.loadSyntheticDemo());
    return;
  }

  if (method === "POST" && pathname === "/api/demo/reset") {
    sendJson(response, 200, repository.reset());
    return;
  }

  if (pathname === "/api/products") {
    if (method === "GET") {
      sendJson(response, 200, { products: repository.listProducts(url.searchParams.get("search") || "") });
      return;
    }
    if (method === "POST") {
      sendJson(response, 201, { product: repository.createProduct(await readJson(request)) });
      return;
    }
  }

  if (method === "POST" && pathname === "/api/products/import") {
    const contentType = request.headers["content-type"] || "";
    const body = await readBody(request);
    const parsed = contentType.includes("text/csv")
      ? parseProductCatalogCsv(body)
      : parseProductCatalogJson(body);
    if (parsed.errors.length) {
      sendJson(response, 400, { imported: 0, products: [], errors: parsed.errors });
      return;
    }
    sendJson(response, 200, repository.importProducts(parsed.products));
    return;
  }

  const productSummaryMatch = pathname.match(/^\/api\/products\/([^/]+)\/summary$/);
  if (productSummaryMatch && method === "GET") {
    sendJson(response, 200, buildProductSummary(repository.snapshot(), decodeURIComponent(productSummaryMatch[1])));
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch) {
    const id = decodeURIComponent(productMatch[1]);
    if (method === "GET") {
      const product = repository.getProduct(id);
      if (!product) throw httpError(404, `Product ${id} was not found.`);
      sendJson(response, 200, { product });
      return;
    }
    if (method === "PUT") {
      sendJson(response, 200, { product: repository.updateProduct(id, await readJson(request)) });
      return;
    }
    if (method === "DELETE") {
      sendJson(response, 200, { product: repository.deleteProduct(id) });
      return;
    }
  }

  if (method === "GET" && pathname === "/api/evidence") {
    sendJson(response, 200, { evidence: repository.listEvidence(filtersFromQuery(url.searchParams)) });
    return;
  }

  const evidenceReviewMatch = pathname.match(/^\/api\/evidence\/([^/]+)\/review$/);
  if (evidenceReviewMatch && method === "PUT") {
    sendJson(response, 200, {
      evidence: repository.updateEvidenceReview(decodeURIComponent(evidenceReviewMatch[1]), await readJson(request))
    });
    return;
  }

  if (method === "GET" && pathname === "/api/connectors") {
    sendJson(response, 200, connectorScheduler.list());
    return;
  }

  if (method === "POST" && pathname === "/api/connectors/run") {
    const payload = await readJson(request);
    sendJson(response, 200, await connectorScheduler.run(payload.connectorIds || [], payload.productIds || [], {
      searchMode: payload.searchMode || "standard",
      perProductLimit: payload.perProductLimit
    }));
    return;
  }

  const connectorRunMatch = pathname.match(/^\/api\/connectors\/([^/]+)\/run$/);
  if (connectorRunMatch && method === "POST") {
    const payload = await readJson(request);
    sendJson(response, 200, await connectorScheduler.run([decodeURIComponent(connectorRunMatch[1])], payload.productIds || [], {
      searchMode: payload.searchMode || "standard",
      perProductLimit: payload.perProductLimit
    }));
    return;
  }

  const connectorMatch = pathname.match(/^\/api\/connectors\/([^/]+)$/);
  if (connectorMatch && method === "PUT") {
    sendJson(response, 200, {
      connector: connectorScheduler.update(decodeURIComponent(connectorMatch[1]), await readJson(request))
    });
    return;
  }

  if (method === "POST" && pathname === "/api/ingest/json") {
    sendJson(response, 200, await ingestJson(request));
    return;
  }

  if (method === "POST" && pathname === "/api/ingest/csv") {
    const body = await readBody(request);
    sendJson(response, 200, repository.ingestEvidenceCsv(body));
    return;
  }

  if (method === "POST" && pathname === "/api/ingest/api") {
    const payload = await readJson(request);
    const records = payload.records || payload.evidence || payload;
    sendJson(response, 200, repository.ingestEvidence(records, payload.source || "api"));
    return;
  }

  if (pathname === "/api/sales") {
    if (method === "GET") {
      sendJson(response, 200, { salesRecords: repository.listSalesRecords() });
      return;
    }
    if (method === "POST") {
      const payload = await readJson(request);
      sendJson(response, 200, repository.ingestSales(payload.records || payload.salesRecords || payload));
      return;
    }
  }

  if (method === "GET" && pathname === "/api/analytics") {
    sendJson(response, 200, buildAnalytics(repository.snapshot(), filtersFromQuery(url.searchParams)));
    return;
  }

  if (method === "GET" && pathname === "/api/leads") {
    sendJson(response, 200, { leads: scoreLeads(repository.snapshot(), filtersFromQuery(url.searchParams)) });
    return;
  }

  if (method === "GET" && pathname === "/api/competitors") {
    const analytics = buildAnalytics(repository.snapshot(), filtersFromQuery(url.searchParams));
    sendJson(response, 200, { shareOfVoice: analytics.shareOfVoice });
    return;
  }

  if (method === "GET" && pathname === "/api/alerts") {
    const state = repository.snapshot();
    sendJson(response, 200, { alerts: evaluateAlerts(state, state.alertRules), rules: state.alertRules });
    return;
  }

  if (method === "GET" && pathname === "/api/export/evidence.csv") {
    const state = repository.snapshot();
    const filters = resolveEvidenceExportFilters(state.products, url.searchParams);
    const product = filters.productId ? state.products.find((item) => item.id === filters.productId) : undefined;
    const evidence = filterEvidence(state.evidence, state.products, filters);
    sendText(response, 200, exportEvidenceCsv(evidence, state.products), "text/csv; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${exportEvidenceFilename(product)}"`
    });
    return;
  }

  if (method === "GET" && pathname === "/api/export/products.csv") {
    const state = repository.snapshot();
    sendText(response, 200, exportProductsCsv(state.products), "text/csv; charset=utf-8", {
      "Content-Disposition": "attachment; filename=\"genecopoeia-products.csv\""
    });
    return;
  }

  if (method === "GET" && pathname === "/api/export/products-evidence.csv") {
    const state = repository.snapshot();
    sendText(response, 200, exportProductEvidenceCsv(state.products, state.evidence), "text/csv; charset=utf-8", {
      "Content-Disposition": "attachment; filename=\"genecopoeia-products-evidence.csv\""
    });
    return;
  }

  if (method === "GET" && pathname === "/api/export/report.html") {
    const state = repository.snapshot();
    const filters = filtersFromQuery(url.searchParams);
    const analytics = buildAnalytics(state, filters);
    const leads = scoreLeads(state, filters);
    const alerts = evaluateAlerts(state, state.alertRules);
    sendText(response, 200, buildPdfReadyReport(state, analytics, leads, alerts), "text/html; charset=utf-8");
    return;
  }

  throw httpError(404, `No route for ${method} ${pathname}.`);
}

async function ingestJson(request) {
  const body = await readBody(request);
  const contentType = request.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    return repository.ingestEvidenceJson(body);
  }

  const payload = body.trim() ? JSON.parse(body) : {};
  if (typeof payload.text === "string") {
    return repository.ingestEvidenceJson(payload.text);
  }
  return repository.ingestEvidence(payload.records || payload.evidence || payload, "json");
}

function filtersFromQuery(searchParams) {
  return {
    productId: searchParams.get("productId") || "",
    sourceType: searchParams.get("sourceType") || "",
    reviewStatus: searchParams.get("reviewStatus") || "",
    country: searchParams.get("country") || "",
    applicationArea: searchParams.get("applicationArea") || "",
    startDate: searchParams.get("startDate") || "",
    endDate: searchParams.get("endDate") || ""
  };
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.resolve(__dirname, `.${requested}`);
  if (!filePath.startsWith(__dirname)) {
    throw httpError(403, "Requested path is outside the repository.");
  }

  try {
    const body = await readFile(filePath);
    sendBuffer(response, 200, body, contentType(filePath));
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "File not found.");
    throw error;
  }
}

async function readJson(request) {
  const body = await readBody(request);
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, body) {
  sendText(response, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function sendText(response, status, body, type, headers = {}) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function sendBuffer(response, status, body, type) {
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".sql": "text/plain; charset=utf-8"
  }[extension] || "application/octet-stream";
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
