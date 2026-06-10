import { hasEuropePmcCompanyContext } from "./europePmcSentences.js";
import { evidenceMatchesProduct } from "./evidenceFiltering.js";

export function buildAnalytics(state, filters = {}) {
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  const products = filterProducts(state.products, filters);
  const evidence = filterEvidence(state.evidence, state.products, filters);
  const salesRecords = filterSales(state.salesRecords, state.products, filters);

  const repeatPurchase = computeRepeatPurchaseRate(salesRecords);
  const totalRevenue = sum(salesRecords.map((record) => record.revenue));

  return {
    filters,
    overview: {
      totalProducts: metric(products.length, products.map((product) => product.id)),
      totalMentions: metric(evidence.length, evidence.map((record) => record.id)),
      curatedMentions: metric(evidence.filter((record) => record.reviewStatus === "curated").length, evidence.filter((record) => record.reviewStatus === "curated").map((record) => record.id)),
      averageConfidence: metric(mean(evidence.map((record) => record.confidenceScore)), evidence.map((record) => record.id)),
      totalRevenue: metric(totalRevenue, salesRecords.map((record) => record.id)),
      repeatPurchaseRate: repeatPurchase
    },
    mentionsBySourceType: groupEvidence(evidence, (record) => record.sourceType),
    mentionsOverTime: mentionsOverTime(evidence),
    topInstitutions: topEvidenceGroups(evidence, (record) => record.institution || "Unknown institution"),
    topAuthors: topEvidenceGroups(evidence.flatMap((record) => {
      return (record.authors || []).map((author) => ({ ...record, author }));
    }), (record) => record.author || "Unknown author"),
    topDiseaseAreas: topEvidenceGroups(evidence.flatMap((record) => {
      return (record.diseaseAreas || []).map((diseaseArea) => ({ ...record, diseaseArea }));
    }), (record) => record.diseaseArea || "Unspecified"),
    shareOfVoice: computeShareOfVoice(evidence),
    citationToRevenue: computeCitationToRevenue(products, evidence, salesRecords),
    growthRateByProduct: computeGrowthRates(products, evidence),
    productPerformance: computeProductPerformance(products, evidence, salesRecords, productMap)
  };
}

export function filterProducts(products, filters = {}) {
  return products.filter((product) => {
    if (filters.productId && product.id !== filters.productId) return false;
    if (filters.applicationArea && normalize(product.applicationArea) !== normalize(filters.applicationArea)) return false;
    return true;
  });
}

export function filterEvidence(evidence, products, filters = {}) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  const filteredProduct = filters.productId ? productMap.get(filters.productId) : undefined;
  return evidence.filter((record) => {
    if (!hasEuropePmcCompanyContext(record)) return false;
    if (filters.productId && !evidenceMatchesProduct(record, filteredProduct)) return false;
    if (filters.sourceType && record.sourceType !== filters.sourceType) return false;
    if (filters.reviewStatus && record.reviewStatus !== filters.reviewStatus) return false;
    if (filters.country && normalize(record.country) !== normalize(filters.country)) return false;
    if (filters.startDate && record.date && record.date < filters.startDate) return false;
    if (filters.endDate && record.date && record.date > filters.endDate) return false;
    if (filters.applicationArea) {
      const hasApplication = record.products?.some((mention) => {
        const product = productMap.get(mention.productId);
        return normalize(product?.applicationArea) === normalize(filters.applicationArea)
          && evidenceMatchesProduct(record, product);
      });
      if (!hasApplication) return false;
    }
    return true;
  });
}

export function computeRepeatPurchaseRate(salesRecords) {
  const grouped = new Map();
  for (const record of salesRecords) {
    const key = `${normalize(record.accountName)}:${record.productId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  const accounts = [...grouped.values()];
  const repeatAccounts = accounts.filter((records) => records.length >= 2);
  return {
    value: accounts.length === 0 ? 0 : repeatAccounts.length / accounts.length,
    numerator: repeatAccounts.length,
    denominator: accounts.length,
    provenanceIds: accounts.flatMap((records) => records.map((record) => record.id)),
    explanation: `${repeatAccounts.length} of ${accounts.length} product-account pairs have two or more orders.`
  };
}

function filterSales(salesRecords, products, filters = {}) {
  const productMap = new Map(products.map((product) => [product.id, product]));
  return salesRecords.filter((record) => {
    if (filters.productId && record.productId !== filters.productId) return false;
    if (filters.country && normalize(record.country) !== normalize(filters.country)) return false;
    if (filters.startDate && record.date && record.date < filters.startDate) return false;
    if (filters.endDate && record.date && record.date > filters.endDate) return false;
    if (filters.applicationArea && normalize(productMap.get(record.productId)?.applicationArea) !== normalize(filters.applicationArea)) return false;
    return true;
  });
}

function groupEvidence(evidence, keyFn) {
  const groups = new Map();
  for (const record of evidence) {
    const key = keyFn(record) || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()]
    .map(([label, records]) => ({
      label,
      count: records.length,
      confidence: mean(records.map((record) => record.confidenceScore)),
      provenanceIds: records.map((record) => record.id)
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function topEvidenceGroups(records, keyFn, limit = 8) {
  return groupEvidence(records, keyFn).slice(0, limit);
}

function mentionsOverTime(evidence) {
  const groups = groupEvidence(evidence.filter((record) => record.date), (record) => record.date.slice(0, 7));
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

function computeShareOfVoice(evidence) {
  const companyEvidence = evidence.filter((record) => record.products?.length);
  const competitorEvidence = evidence.flatMap((record) => {
    return (record.competitorMentions || []).map((mention) => ({
      id: record.id,
      competitorName: mention.competitorName,
      confidenceScore: mention.confidence
    }));
  });

  const entries = [
    {
      label: "GeneCopoeia products",
      count: companyEvidence.length,
      provenanceIds: companyEvidence.map((record) => record.id)
    },
    ...groupCompetitors(competitorEvidence)
  ];
  const total = sum(entries.map((entry) => entry.count));

  return entries
    .map((entry) => ({
      ...entry,
      share: total === 0 ? 0 : entry.count / total
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function groupCompetitors(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.competitorName)) groups.set(record.competitorName, []);
    groups.get(record.competitorName).push(record);
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    count: group.length,
    provenanceIds: group.map((record) => record.id)
  }));
}

function computeCitationToRevenue(products, evidence, salesRecords) {
  return products.map((product) => {
    const productEvidence = evidenceForProduct(evidence, product);
    const citationEvidence = productEvidence.filter((record) => ["publication", "conference_abstract", "protocol"].includes(record.sourceType));
    const productSales = salesRecords.filter((record) => record.productId === product.id);
    const revenue = sum(productSales.map((record) => record.revenue));
    return {
      productId: product.id,
      productName: product.productName,
      citations: citationEvidence.length,
      revenue,
      value: revenue === 0 ? citationEvidence.length : citationEvidence.length / (revenue / 1000),
      provenanceIds: citationEvidence.map((record) => record.id),
      salesRecordIds: productSales.map((record) => record.id),
      explanation: revenue === 0
        ? "No matched revenue; value is citation count."
        : "Citations per $1K of matched sales revenue."
    };
  }).sort((a, b) => b.value - a.value || a.productName.localeCompare(b.productName));
}

function computeGrowthRates(products, evidence) {
  const latest = latestDate(evidence.map((record) => record.date));
  return products.map((product) => {
    const productEvidence = evidenceForProduct(evidence, product);
    const current = productEvidence.filter((record) => daysBetween(record.date, latest) <= 90);
    const previous = productEvidence.filter((record) => {
      const days = daysBetween(record.date, latest);
      return days > 90 && days <= 180;
    });
    const value = previous.length === 0
      ? (current.length > 0 ? 1 : 0)
      : (current.length - previous.length) / previous.length;
    return {
      productId: product.id,
      productName: product.productName,
      currentMentions: current.length,
      previousMentions: previous.length,
      value,
      provenanceIds: [...current, ...previous].map((record) => record.id)
    };
  }).sort((a, b) => b.value - a.value || b.currentMentions - a.currentMentions);
}

function computeProductPerformance(products, evidence, salesRecords) {
  return products.map((product) => {
    const productEvidence = evidenceForProduct(evidence, product);
    const productSales = salesRecords.filter((record) => record.productId === product.id);
    const institutions = unique(productEvidence.map((record) => record.institution).filter(Boolean));
    const revenue = sum(productSales.map((record) => record.revenue));
    return {
      productId: product.id,
      productName: product.productName,
      applicationArea: product.applicationArea,
      mentions: productEvidence.length,
      institutions: institutions.length,
      revenue,
      averageConfidence: mean(productEvidence.map((record) => record.confidenceScore)),
      provenanceIds: productEvidence.map((record) => record.id),
      salesRecordIds: productSales.map((record) => record.id)
    };
  }).sort((a, b) => b.mentions - a.mentions || b.revenue - a.revenue || a.productName.localeCompare(b.productName));
}

function evidenceForProduct(evidence, product) {
  return evidence.filter((record) => evidenceMatchesProduct(record, product));
}

function metric(value, provenanceIds = []) {
  return { value, provenanceIds };
}

function daysBetween(date, latest) {
  if (!date || !latest) return Number.POSITIVE_INFINITY;
  return Math.floor((new Date(latest).getTime() - new Date(date).getTime()) / 86400000);
}

function latestDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return sum(clean) / clean.length;
}
