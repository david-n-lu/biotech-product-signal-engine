export const DEFAULT_ALERT_RULES = [
  {
    id: "RULE-CITATION-SPIKE",
    ruleType: "sudden_citation_spike",
    name: "Sudden citation spike",
    threshold: 2,
    windowDays: 45,
    status: "active"
  },
  {
    id: "RULE-HIGH-IMPACT",
    ruleType: "new_high_impact_paper",
    name: "New high-impact paper",
    threshold: 8,
    windowDays: 90,
    status: "active"
  },
  {
    id: "RULE-PATENT",
    ruleType: "new_patent_mention",
    name: "New patent mention",
    threshold: 1,
    windowDays: 120,
    status: "active"
  },
  {
    id: "RULE-TRIAL",
    ruleType: "new_clinical_trial_mention",
    name: "New clinical trial mention",
    threshold: 1,
    windowDays: 120,
    status: "active"
  },
  {
    id: "RULE-REACTIVATION",
    ruleType: "major_account_reactivation",
    name: "Major account reactivation",
    threshold: 120,
    windowDays: 60,
    status: "active"
  },
  {
    id: "RULE-COMPETITOR",
    ruleType: "competitor_surge",
    name: "Competitor surge",
    threshold: 2,
    windowDays: 90,
    status: "active"
  }
];

export function evaluateAlerts(state, rules = DEFAULT_ALERT_RULES) {
  const productMap = new Map(state.products.map((product) => [product.id, product]));
  const latest = latestDate([
    ...state.evidence.map((record) => record.date),
    ...state.salesRecords.map((record) => record.date)
  ]);
  const alerts = [];

  for (const rule of rules.filter((item) => item.status !== "paused")) {
    if (rule.ruleType === "sudden_citation_spike") {
      alerts.push(...citationSpikeAlerts(state, productMap, rule, latest));
    }
    if (rule.ruleType === "new_high_impact_paper") {
      alerts.push(...highImpactAlerts(state, productMap, rule, latest));
    }
    if (rule.ruleType === "new_patent_mention") {
      alerts.push(...sourceTypeAlerts(state, productMap, rule, latest, "patent", "New patent mention"));
    }
    if (rule.ruleType === "new_clinical_trial_mention") {
      alerts.push(...sourceTypeAlerts(state, productMap, rule, latest, "trial", "New clinical trial mention"));
    }
    if (rule.ruleType === "major_account_reactivation") {
      alerts.push(...reactivationAlerts(state, productMap, rule, latest));
    }
    if (rule.ruleType === "competitor_surge") {
      alerts.push(...competitorSurgeAlerts(state, rule, latest));
    }
  }

  return alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.createdAt.localeCompare(a.createdAt));
}

function citationSpikeAlerts(state, productMap, rule, latest) {
  const alerts = [];
  for (const product of state.products) {
    const publications = productEvidence(state.evidence, product.id).filter((record) => record.sourceType === "publication");
    const current = publications.filter((record) => daysBetween(record.date, latest) <= rule.windowDays);
    const previous = publications.filter((record) => {
      const days = daysBetween(record.date, latest);
      return days > rule.windowDays && days <= rule.windowDays * 2;
    });
    if (current.length >= rule.threshold && current.length >= Math.max(1, previous.length * 2)) {
      alerts.push(alert({
        rule,
        product,
        title: `${product.productName} citation spike`,
        severity: "high",
        confidence: mean(current.map((record) => record.confidenceScore)),
        evidenceIds: current.map((record) => record.id),
        explanation: `${current.length} publication mentions in the latest ${rule.windowDays} days versus ${previous.length} in the prior window.`
      }));
    }
  }
  return alerts;
}

function highImpactAlerts(state, productMap, rule, latest) {
  return state.evidence
    .filter((record) => record.sourceType === "publication")
    .filter((record) => daysBetween(record.date, latest) <= rule.windowDays)
    .filter((record) => Number(record.impactScore || 0) >= rule.threshold || record.confidenceScore >= 0.82)
    .flatMap((record) => (record.products || []).map((mention) => {
      const product = productMap.get(mention.productId);
      return alert({
        rule,
        product,
        title: `High-impact paper mentions ${product?.productName || mention.productName}`,
        severity: "high",
        confidence: record.confidenceScore,
        evidenceIds: [record.id],
        explanation: `${record.sourceTitle} has stored impact score ${record.impactScore ?? "not supplied"} and confidence ${formatPercent(record.confidenceScore)}.`
      });
    }));
}

function sourceTypeAlerts(state, productMap, rule, latest, sourceType, label) {
  return state.evidence
    .filter((record) => record.sourceType === sourceType)
    .filter((record) => daysBetween(record.date, latest) <= rule.windowDays)
    .flatMap((record) => (record.products || []).map((mention) => {
      const product = productMap.get(mention.productId);
      return alert({
        rule,
        product,
        title: `${label}: ${product?.productName || mention.productName}`,
        severity: sourceType === "trial" ? "high" : "medium",
        confidence: record.confidenceScore,
        evidenceIds: [record.id],
        explanation: `${record.sourceTitle} is stored as ${sourceType} evidence.`
      });
    }));
}

function reactivationAlerts(state, productMap, rule, latest) {
  const groups = new Map();
  for (const record of state.salesRecords) {
    const key = `${record.productId}:${normalize(record.accountName)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }

  const alerts = [];
  for (const records of groups.values()) {
    const sorted = records.slice().sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) continue;
    const current = sorted[sorted.length - 1];
    const previous = sorted[sorted.length - 2];
    const gap = daysBetween(previous.date, current.date);
    if (daysBetween(current.date, latest) <= rule.windowDays && gap >= rule.threshold) {
      const product = productMap.get(current.productId);
      alerts.push(alert({
        rule,
        product,
        title: `${current.accountName} reactivated ${product?.productName || current.productId}`,
        severity: "medium",
        confidence: 0.78,
        salesRecordIds: [previous.id, current.id],
        explanation: `${gap} days between matched purchases; latest order is within ${rule.windowDays} days of the latest stored activity.`
      }));
    }
  }
  return alerts;
}

function competitorSurgeAlerts(state, rule, latest) {
  const recent = state.evidence.filter((record) => daysBetween(record.date, latest) <= rule.windowDays);
  const counts = new Map();
  for (const record of recent) {
    for (const mention of record.competitorMentions || []) {
      const key = mention.competitorName;
      if (!counts.has(key)) counts.set(key, []);
      counts.get(key).push(record);
    }
  }

  return [...counts.entries()]
    .filter(([, records]) => records.length >= rule.threshold)
    .map(([competitorName, records]) => alert({
      rule,
      title: `${competitorName} share-of-voice surge`,
      severity: "medium",
      confidence: mean(records.map((record) => record.confidenceScore)),
      evidenceIds: records.map((record) => record.id),
      explanation: `${records.length} competitor mentions in the latest ${rule.windowDays} days.`
    }));
}

function productEvidence(evidence, productId) {
  return evidence.filter((record) => record.products?.some((mention) => mention.productId === productId));
}

function alert({ rule, product, title, severity, confidence, evidenceIds = [], salesRecordIds = [], explanation }) {
  return {
    id: `ALERT:${rule.id}:${product?.id || "GLOBAL"}:${hash(`${title}:${evidenceIds.join(",")}:${salesRecordIds.join(",")}`)}`,
    ruleId: rule.id,
    ruleType: rule.ruleType,
    productId: product?.id,
    productName: product?.productName,
    title,
    severity,
    createdAt: new Date().toISOString(),
    confidence: round(confidence || 0),
    evidenceIds,
    salesRecordIds,
    explanation
  };
}

function latestDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  if (!start || !end) return Number.POSITIVE_INFINITY;
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86400000);
}

function severityRank(severity) {
  return { info: 1, medium: 2, high: 3 }[severity] || 0;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function hash(value) {
  let output = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    output = ((output << 5) - output + text.charCodeAt(index)) | 0;
  }
  return Math.abs(output).toString(36).toUpperCase();
}
