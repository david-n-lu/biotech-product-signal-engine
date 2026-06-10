import { evidenceForProduct } from "./evidenceFiltering.js";
import { europePmcSentencesText } from "./europePmcSentences.js";

export function exportEvidenceCsv(evidence, products = []) {
  const productMap = new Map((products || []).map((product) => [product.id, product]));
  const headers = [
    "id",
    "catalogNumber",
    "productName",
    "sourceType",
    "sourceTitle",
    "sourceUrl",
    "sourceId",
    "date",
    "authors",
    "institution",
    "country",
    "contextLabel",
    "europePmcSentences",
    "reviewStatus",
    "connectorId",
    "confidenceScore",
    "productIds",
    "competitors",
    "provenance"
  ];

  const rows = evidence.map((record) => ({
    id: record.id,
    catalogNumber: productCatalogNumbers(record, productMap),
    productName: productNames(record, productMap),
    sourceType: record.sourceType,
    sourceTitle: record.sourceTitle,
    sourceUrl: record.sourceUrl || "",
    sourceId: record.sourceId || "",
    date: record.date || "",
    authors: (record.authors || []).join("; "),
    institution: record.institution || "",
    country: record.country || "",
    contextLabel: record.contextLabel,
    europePmcSentences: evidenceEuropePmcSentences(record),
    reviewStatus: record.reviewStatus,
    connectorId: record.connectorId || "",
    confidenceScore: record.confidenceScore,
    productIds: (record.products || []).map((mention) => mention.productId).join("; "),
    competitors: (record.competitorMentions || []).map((mention) => mention.competitorName).join("; "),
    provenance: record.sourceUrl || record.sourceId || ""
  }));

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))
  ].join("\n");
}

export function exportEvidenceFilename(product) {
  if (!product) return "genecopoeia-evidence.csv";
  const catalog = safeFilenamePart(product.catalogNumber);
  const name = safeFilenamePart(product.productName);
  const suffix = [catalog, name].filter(Boolean).join("-");
  return suffix ? `genecopoeia-${suffix}-evidence.csv` : "genecopoeia-evidence.csv";
}

export function exportProductsCsv(products = []) {
  const headers = [
    "id",
    "company",
    "productName",
    "catalogNumber",
    "rrid",
    "productType",
    "applicationArea",
    "synonyms",
    "competitorEquivalents",
    "internalOwner",
    "createdAt",
    "updatedAt"
  ];

  const rows = (products || []).map((product) => ({
    id: product.id,
    company: product.company,
    productName: product.productName,
    catalogNumber: product.catalogNumber,
    rrid: product.rrid,
    productType: product.productType,
    applicationArea: product.applicationArea,
    synonyms: (product.synonyms || []).join("; "),
    competitorEquivalents: (product.competitorEquivalents || []).join("; "),
    internalOwner: product.internalOwner,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt
  }));

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))
  ].join("\n");
}

export function exportProductEvidenceCsv(products = [], evidence = []) {
  const headers = [
    "productId",
    "company",
    "productName",
    "catalogNumber",
    "rrid",
    "productType",
    "applicationArea",
    "synonyms",
    "competitorEquivalents",
    "internalOwner",
    "evidenceId",
    "sourceType",
    "sourceTitle",
    "sourceUrl",
    "sourceId",
    "date",
    "authors",
    "institution",
    "country",
    "contextLabel",
    "europePmcSentences",
    "reviewStatus",
    "connectorId",
    "confidenceScore",
    "productMentionType",
    "matchedText",
    "mentionConfidence",
    "competitors",
    "provenance"
  ];

  const rows = (products || []).flatMap((product) => {
    const productEvidence = evidenceForProduct(evidence, product);
    if (!productEvidence.length) return [productEvidenceRow(product)];
    return productEvidence.map((record) => productEvidenceRow(product, record));
  });

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))
  ].join("\n");
}

export function buildPdfReadyReport(state, analytics, leads, alerts) {
  const generatedAt = new Date().toISOString();
  const productRows = analytics.productPerformance.map((product) => {
    return `<tr><td>${escapeHtml(product.productName)}</td><td>${escapeHtml(product.applicationArea)}</td><td>${product.mentions}</td><td>${product.institutions}</td><td>${money(product.revenue)}</td><td>${formatPercent(product.averageConfidence)}</td></tr>`;
  }).join("");

  const leadRows = leads.slice(0, 10).map((lead) => {
    return `<tr><td>${escapeHtml(lead.institution)}</td><td>${escapeHtml(lead.productName)}</td><td>${lead.score}</td><td>${formatPercent(lead.confidence)}</td><td>${escapeHtml(lead.recommendedAction)}</td></tr>`;
  }).join("");

  const alertRows = alerts.slice(0, 10).map((alert) => {
    return `<tr><td>${escapeHtml(alert.severity)}</td><td>${escapeHtml(alert.title)}</td><td>${formatPercent(alert.confidence)}</td><td>${escapeHtml([...alert.evidenceIds, ...alert.salesRecordIds].join(", "))}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Genecopoeia Product Signal Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17212b; margin: 32px; }
    h1, h2 { margin-bottom: 8px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .kpi { border: 1px solid #ccd6dd; border-radius: 6px; padding: 12px; }
    .kpi strong { display: block; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; }
    th, td { border-bottom: 1px solid #ccd6dd; text-align: left; padding: 8px; vertical-align: top; }
    th { background: #eef3f6; }
    @media print { body { margin: 18mm; } .kpis { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <h1>Genecopoeia Product Signal Report</h1>
  <p>Generated ${escapeHtml(generatedAt)} from stored registry, evidence, and sales records only.</p>
  <section class="kpis">
    <div class="kpi"><span>Products</span><strong>${analytics.overview.totalProducts.value}</strong></div>
    <div class="kpi"><span>Mentions</span><strong>${analytics.overview.totalMentions.value}</strong></div>
    <div class="kpi"><span>Revenue</span><strong>${money(analytics.overview.totalRevenue.value)}</strong></div>
    <div class="kpi"><span>Repeat purchase</span><strong>${formatPercent(analytics.overview.repeatPurchaseRate.value)}</strong></div>
  </section>
  <h2>Product Performance</h2>
  <table><thead><tr><th>Product</th><th>Application</th><th>Mentions</th><th>Institutions</th><th>Revenue</th><th>Confidence</th></tr></thead><tbody>${productRows || emptyRow(6)}</tbody></table>
  <h2>Top Leads</h2>
  <table><thead><tr><th>Institution</th><th>Product</th><th>Lead score</th><th>Confidence</th><th>Action</th></tr></thead><tbody>${leadRows || emptyRow(5)}</tbody></table>
  <h2>Alerts</h2>
  <table><thead><tr><th>Severity</th><th>Alert</th><th>Confidence</th><th>Provenance</th></tr></thead><tbody>${alertRows || emptyRow(4)}</tbody></table>
</body>
</html>`;
}

function csv(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function productCatalogNumbers(record, productMap) {
  return unique((record.products || [])
    .map((mention) => productMap.get(mention.productId)?.catalogNumber)
    .filter(Boolean))
    .join("; ");
}

function productNames(record, productMap) {
  return unique((record.products || [])
    .map((mention) => productMap.get(mention.productId)?.productName || mention.productName)
    .filter(Boolean))
    .join("; ");
}

function productEvidenceRow(product, record = undefined) {
  const mention = record ? productMention(record, product.id) : {};
  return {
    productId: product.id,
    company: product.company,
    productName: product.productName,
    catalogNumber: product.catalogNumber,
    rrid: product.rrid,
    productType: product.productType,
    applicationArea: product.applicationArea,
    synonyms: (product.synonyms || []).join("; "),
    competitorEquivalents: (product.competitorEquivalents || []).join("; "),
    internalOwner: product.internalOwner,
    evidenceId: record?.id || "",
    sourceType: record?.sourceType || "",
    sourceTitle: record?.sourceTitle || "",
    sourceUrl: record?.sourceUrl || "",
    sourceId: record?.sourceId || "",
    date: record?.date || "",
    authors: (record?.authors || []).join("; "),
    institution: record?.institution || "",
    country: record?.country || "",
    contextLabel: record?.contextLabel || "",
    europePmcSentences: evidenceEuropePmcSentences(record),
    reviewStatus: record?.reviewStatus || "",
    connectorId: record?.connectorId || "",
    confidenceScore: record?.confidenceScore ?? "",
    productMentionType: record?.productMentionType || "",
    matchedText: mention.matchedText || "",
    mentionConfidence: mention.confidence ?? "",
    competitors: productCompetitors(record, product.id),
    provenance: record?.sourceUrl || record?.sourceId || ""
  };
}

function evidenceEuropePmcSentences(record) {
  return europePmcSentencesText(record);
}

function productMention(record, productId) {
  return (record.products || []).find((mention) => mention.productId === productId) || {};
}

function productCompetitors(record, productId) {
  return unique((record?.competitorMentions || [])
    .filter((mention) => !productId || mention.productId === productId)
    .map((mention) => mention.competitorName)
    .filter(Boolean))
    .join("; ");
}

function safeFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function unique(values) {
  return [...new Set(values)];
}

function emptyRow(columns) {
  return `<tr><td colspan="${columns}">No stored records.</td></tr>`;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
