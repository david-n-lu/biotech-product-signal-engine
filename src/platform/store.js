import { DEFAULT_ALERT_RULES } from "./alerts.js";
import {
  importEvidenceFromCsvText,
  importEvidenceFromJsonText,
  normalizeEvidenceRecords,
  normalizeSalesRecords
} from "./ingestion.js";
import { evidenceMatchesProduct } from "./evidenceFiltering.js";
import { hasEuropePmcCompanyContext } from "./europePmcSentences.js";
import { searchProducts } from "./matching.js";
import { SYNTHETIC_DEMO_DATA } from "./sampleData.js";

export function createRepository(initialState = {}) {
  let state = {
    products: [],
    evidence: [],
    salesRecords: [],
    alertRules: clone(DEFAULT_ALERT_RULES),
    ingestBatches: []
  };

  if (initialState.products || initialState.evidence || initialState.salesRecords) {
    state = hydrateState(initialState);
  }

  return {
    snapshot() {
      return clone(state);
    },
    restoreSnapshot(input) {
      state = hydrateState(input || {});
      return clone(state);
    },
    reset() {
      state = {
        products: [],
        evidence: [],
        salesRecords: [],
        alertRules: clone(DEFAULT_ALERT_RULES),
        ingestBatches: []
      };
      return clone(state);
    },
    loadSyntheticDemo() {
      state = hydrateState(SYNTHETIC_DEMO_DATA);
      return clone(state);
    },
    listProducts(query = "") {
      if (!query) return clone(state.products);
      return searchProducts(query, state.products).map((result) => ({
        ...clone(result.product),
        searchScore: result.score,
        searchReasons: result.reasons
      }));
    },
    getProduct(id) {
      return clone(state.products.find((product) => product.id === id));
    },
    createProduct(input) {
      const product = normalizeProduct(input);
      if (state.products.some((item) => item.id === product.id)) {
        throw httpError(409, `Product ${product.id} already exists.`);
      }
      state.products.push(product);
      state.products.sort((a, b) => a.productName.localeCompare(b.productName));
      return clone(product);
    },
    importProducts(inputs) {
      const products = [];
      const errors = [];
      const list = Array.isArray(inputs) ? inputs : [inputs];
      for (let index = 0; index < list.length; index += 1) {
        try {
          const product = normalizeProduct(list[index]);
          const existingIndex = state.products.findIndex((item) => item.id === product.id);
          if (existingIndex >= 0) {
            product.createdAt = state.products[existingIndex].createdAt;
            product.updatedAt = new Date().toISOString();
            state.products[existingIndex] = product;
          } else {
            state.products.push(product);
          }
          products.push(product);
        } catch (error) {
          errors.push(`Product ${index + 1}: ${error.message}`);
        }
      }
      state.products.sort((a, b) => a.productName.localeCompare(b.productName));
      return { imported: products.length, products: clone(products), errors };
    },
    updateProduct(id, input) {
      const index = state.products.findIndex((product) => product.id === id);
      if (index < 0) throw httpError(404, `Product ${id} was not found.`);
      const product = normalizeProduct({ ...state.products[index], ...input, id });
      product.createdAt = state.products[index].createdAt;
      product.updatedAt = new Date().toISOString();
      state.products[index] = product;
      return clone(product);
    },
    deleteProduct(id) {
      const product = state.products.find((item) => item.id === id);
      if (!product) throw httpError(404, `Product ${id} was not found.`);
      state.products = state.products.filter((item) => item.id !== id);
      state.salesRecords = state.salesRecords.filter((record) => record.productId !== id);
      state.evidence = state.evidence.map((record) => ({
        ...record,
        products: (record.products || []).filter((mention) => mention.productId !== id),
        competitorMentions: (record.competitorMentions || []).filter((mention) => mention.productId !== id)
      }));
      return clone(product);
    },
    listEvidence(filters = {}) {
      const filteredProduct = filters.productId
        ? state.products.find((product) => product.id === filters.productId)
        : undefined;
      return clone(state.evidence.filter((record) => {
        if (!hasEuropePmcCompanyContext(record)) return false;
        if (filters.productId && !evidenceMatchesProduct(record, filteredProduct)) return false;
        if (filters.sourceType && record.sourceType !== filters.sourceType) return false;
        if (filters.country && record.country !== filters.country) return false;
        if (filters.reviewStatus && record.reviewStatus !== filters.reviewStatus) return false;
        return true;
      }));
    },
    updateEvidenceReview(id, input) {
      const index = state.evidence.findIndex((record) => record.id === id);
      if (index < 0) throw httpError(404, `Evidence ${id} was not found.`);
      const reviewStatus = clean(input.reviewStatus || input.review_status);
      if (!["candidate", "curated", "rejected"].includes(reviewStatus)) {
        throw httpError(400, "reviewStatus must be candidate, curated, or rejected.");
      }
      const confidenceScore = input.confidenceScore ?? input.confidence_score;
      const next = {
        ...state.evidence[index],
        reviewStatus,
        reviewedAt: new Date().toISOString(),
        reviewer: clean(input.reviewer) || "scientist-review",
        reviewNotes: clean(input.reviewNotes || input.review_notes) || state.evidence[index].reviewNotes
      };
      if (confidenceScore !== undefined) {
        const numeric = Number(confidenceScore);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
          throw httpError(400, "confidenceScore must be a number from 0 to 1.");
        }
        next.confidenceScore = Math.round(numeric * 1000) / 1000;
      }
      state.evidence[index] = next;
      return clone(next);
    },
    ingestEvidence(records, source = "json") {
      const result = normalizeEvidenceRecords(records, state.products);
      if (result.records.length) mergeById(state.evidence, result.records);
      recordBatch(source, result.records, result.errors);
      return { imported: result.records.length, records: clone(result.records), errors: result.errors };
    },
    ingestEvidenceJson(text) {
      const result = importEvidenceFromJsonText(text, state.products);
      if (result.records.length) mergeById(state.evidence, result.records);
      recordBatch("json", result.records, result.errors);
      return { imported: result.records.length, records: clone(result.records), errors: result.errors };
    },
    ingestEvidenceCsv(text) {
      const result = importEvidenceFromCsvText(text, state.products);
      if (result.records.length) mergeById(state.evidence, result.records);
      recordBatch("csv", result.records, result.errors);
      return { imported: result.records.length, records: clone(result.records), errors: result.errors };
    },
    listSalesRecords() {
      return clone(state.salesRecords);
    },
    ingestSales(records) {
      const result = normalizeSalesRecords(records, state.products);
      if (result.records.length) mergeById(state.salesRecords, result.records);
      recordBatch("sales", result.records, result.errors);
      return { imported: result.records.length, records: clone(result.records), errors: result.errors };
    },
    listAlertRules() {
      return clone(state.alertRules);
    }
  };

  function recordBatch(source, records, errors) {
    state.ingestBatches.push({
      id: `BATCH-${state.ingestBatches.length + 1}`,
      source,
      imported: records.length,
      errors,
      createdAt: new Date().toISOString()
    });
  }
}

export function hydrateState(input) {
  const products = (input.products || []).map(normalizeProduct);
  const evidenceResult = normalizeEvidenceRecords(input.evidence || [], products);
  const salesResult = normalizeSalesRecords(input.salesRecords || [], products);
  return {
    products,
    evidence: evidenceResult.records,
    salesRecords: salesResult.records,
    alertRules: clone(input.alertRules || DEFAULT_ALERT_RULES),
    ingestBatches: []
  };
}

function normalizeProduct(input) {
  const company = clean(input.company) || "GeneCopoeia";
  const productName = clean(input.productName || input.product_name || input.name);
  const productType = clean(input.productType || input.product_type);
  const applicationArea = clean(input.applicationArea || input.application_area);
  if (!productName) throw httpError(400, "productName is required.");
  if (!productType) throw httpError(400, "productType is required.");
  if (!applicationArea) throw httpError(400, "applicationArea is required.");

  const now = new Date().toISOString();
  return {
    id: clean(input.id) || buildProductId(company, productName, input.catalogNumber || input.catalog_number),
    company,
    productName,
    catalogNumber: clean(input.catalogNumber || input.catalog_number),
    rrid: clean(input.rrid || input.RRID),
    productType,
    applicationArea,
    synonyms: normalizeList(input.synonyms),
    competitorEquivalents: normalizeList(input.competitorEquivalents || input.competitor_equivalents),
    internalOwner: clean(input.internalOwner || input.internal_owner),
    productUrl: clean(input.productUrl || input.product_url),
    datasheetUrl: clean(input.datasheetUrl || input.datasheet_url),
    size: clean(input.size),
    listPrice: clean(input.listPrice || input.list_price),
    leadTime: clean(input.leadTime || input.lead_time),
    shippingCondition: clean(input.shippingCondition || input.shipping_condition),
    storageCondition: clean(input.storageCondition || input.storage_condition),
    createdAt: clean(input.createdAt) || now,
    updatedAt: clean(input.updatedAt) || now
  };
}

function mergeById(target, incoming) {
  const byId = new Map(target.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  target.splice(0, target.length, ...[...byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

function buildProductId(company, productName, catalogNumber) {
  return `PROD-${hash(`${company}:${productName}:${catalogNumber || ""}`)}`;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (typeof value === "string") return value.split(/[;|]/).map(clean).filter(Boolean);
  return [];
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(value) {
  let output = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    output = ((output << 5) - output + text.charCodeAt(index)) | 0;
  }
  return Math.abs(output).toString(36).toUpperCase();
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
