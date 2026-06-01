import { filterEvidence } from "./analytics.js";

export function scoreLeads(state, filters = {}) {
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  const evidence = filterEvidence(state.evidence, state.products, filters);
  const salesRecords = filterSalesForLeads(state.salesRecords, filters);
  const latest = latestDate([
    ...evidence.map((record) => record.date),
    ...salesRecords.map((record) => record.date)
  ]);

  const groups = new Map();

  for (const record of evidence) {
    for (const mention of record.products || []) {
      const key = leadKey(record.institution, mention.productId);
      if (!groups.has(key)) groups.set(key, emptyLead(record.institution, record.country, mention.productId));
      groups.get(key).evidence.push(record);
    }
  }

  for (const record of salesRecords) {
    const key = leadKey(record.institution || record.accountName, record.productId);
    if (!groups.has(key)) groups.set(key, emptyLead(record.institution || record.accountName, record.country, record.productId));
    groups.get(key).salesRecords.push(record);
  }

  return [...groups.values()]
    .map((group) => scoreLeadGroup(group, productMap, latest))
    .filter((lead) => lead.institution && lead.productId)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.institution.localeCompare(b.institution));
}

function scoreLeadGroup(group, productMap, latest) {
  const evidence = group.evidence;
  const salesRecords = group.salesRecords;
  const product = productMap.get(group.productId);
  const featureInputs = {
    publicationFrequency: evidence.filter((record) => record.sourceType === "publication"),
    recentMentions: evidence.filter((record) => daysBetween(record.date, latest) <= 90),
    grantActivity: evidence.filter((record) => record.sourceType === "grant"),
    protocolUsage: evidence.filter((record) => record.sourceType === "protocol"),
    conferenceActivity: evidence.filter((record) => record.sourceType === "conference_abstract"),
    trialActivity: evidence.filter((record) => record.sourceType === "trial")
  };

  const reasons = [
    evidenceFeature("publicationFrequency", "Publication frequency", Math.min(24, featureInputs.publicationFrequency.length * 8), featureInputs.publicationFrequency),
    evidenceFeature("recentMentions", "Recent mentions", Math.min(22, featureInputs.recentMentions.length * 7), featureInputs.recentMentions),
    evidenceFeature("grantActivity", "Grant activity", Math.min(18, featureInputs.grantActivity.length * 12), featureInputs.grantActivity),
    institutionFeature(group.institution, evidence),
    salesFeature(salesRecords),
    evidenceFeature("protocolUsage", "Protocol usage", Math.min(14, featureInputs.protocolUsage.length * 10), featureInputs.protocolUsage),
    evidenceFeature("conferenceActivity", "Conference activity", Math.min(12, featureInputs.conferenceActivity.length * 8), featureInputs.conferenceActivity),
    evidenceFeature("trialActivity", "Clinical trial activity", Math.min(10, featureInputs.trialActivity.length * 10), featureInputs.trialActivity)
  ].filter((reason) => reason.points > 0);

  const score = Math.min(100, Math.round(reasons.reduce((total, reason) => total + reason.points, 0)));
  const confidence = clamp01(0.2
    + Math.min(0.35, evidence.length * 0.055)
    + Math.min(0.25, salesRecords.length * 0.08)
    + mean(evidence.map((record) => record.confidenceScore)) * 0.35);

  return {
    id: `LEAD:${group.productId}:${slug(group.institution)}`,
    institution: group.institution,
    country: group.country,
    productId: group.productId,
    productName: product?.productName || group.productId,
    applicationArea: product?.applicationArea || "",
    score,
    confidence: round(confidence),
    evidenceIds: evidence.map((record) => record.id),
    salesRecordIds: salesRecords.map((record) => record.id),
    topContributingFeatures: reasons.sort((a, b) => b.points - a.points),
    recommendedAction: recommendAction(evidence, salesRecords)
  };
}

function evidenceFeature(feature, label, points, records) {
  return {
    feature,
    label,
    points,
    evidenceIds: records.map((record) => record.id),
    salesRecordIds: [],
    explanation: `${records.length} matched ${records.length === 1 ? "record" : "records"}.`
  };
}

function institutionFeature(institution, records) {
  const normalized = institution.toLowerCase();
  const largeSignals = /\buniversity\b|\bmedical center\b|\bresearch institute\b|\btherapeutics\b|\bhospital\b/.test(normalized);
  const points = largeSignals ? 10 : Math.min(8, records.length * 2);
  return {
    feature: "institutionSize",
    label: "Institution size signal",
    points,
    evidenceIds: records.map((record) => record.id),
    salesRecordIds: [],
    explanation: largeSignals
      ? "Institution name indicates a large research or clinical account."
      : "Institution size inferred from available activity volume."
  };
}

function salesFeature(records) {
  const repeat = records.length >= 2;
  const points = records.length === 0 ? 0 : Math.min(22, 12 + records.length * 4 + (repeat ? 6 : 0));
  return {
    feature: "pastPurchases",
    label: repeat ? "Past purchases and reorder history" : "Past purchase",
    points,
    evidenceIds: [],
    salesRecordIds: records.map((record) => record.id),
    explanation: repeat
      ? "Account has two or more matched purchases for this product."
      : "Account has a matched purchase for this product."
  };
}

function recommendAction(evidence, salesRecords) {
  if (salesRecords.length >= 2 && evidence.some((record) => daysAgo(record.date) <= 90)) {
    return "Prioritize reorder conversation tied to recent scientific activity.";
  }
  if (salesRecords.length > 0) {
    return "Offer application support and expansion bundles for the active account.";
  }
  if (evidence.some((record) => record.sourceType === "grant")) {
    return "Engage before project start with grant-aligned product guidance.";
  }
  if (evidence.some((record) => record.sourceType === "conference_abstract")) {
    return "Follow up with the presenting lab while methods are still active.";
  }
  return "Qualify the account with provenance-linked evidence of product usage.";
}

function filterSalesForLeads(salesRecords, filters) {
  return salesRecords.filter((record) => {
    if (filters.productId && record.productId !== filters.productId) return false;
    if (filters.country && normalize(record.country) !== normalize(filters.country)) return false;
    if (filters.startDate && record.date && record.date < filters.startDate) return false;
    if (filters.endDate && record.date && record.date > filters.endDate) return false;
    return true;
  });
}

function emptyLead(institution, country, productId) {
  return {
    institution: institution || "Unknown institution",
    country: country || "",
    productId,
    evidence: [],
    salesRecords: []
  };
}

function leadKey(institution, productId) {
  return `${slug(institution || "unknown")}:${productId}`;
}

function latestDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
}

function daysBetween(date, latest) {
  if (!date || !latest) return Number.POSITIVE_INFINITY;
  return Math.floor((new Date(latest).getTime() - new Date(date).getTime()) / 86400000);
}

function daysAgo(date) {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function slug(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
