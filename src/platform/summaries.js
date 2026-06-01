import { scoreLeads } from "./leadScoring.js";

export function buildProductSummary(state, productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    return {
      productId,
      confidence: 0,
      provenanceIds: [],
      sections: [{
        title: "Product not found",
        text: "No product registry record matched this identifier."
      }]
    };
  }

  const evidence = state.evidence.filter((record) => record.products?.some((mention) => mention.productId === product.id));
  const salesRecords = state.salesRecords.filter((record) => record.productId === product.id);
  const leads = scoreLeads(state, { productId: product.id }).slice(0, 3);
  const provenanceIds = evidence.map((record) => record.id);
  const confidence = evidence.length ? mean(evidence.map((record) => record.confidenceScore)) : 0;

  if (evidence.length === 0 && salesRecords.length === 0) {
    return {
      productId: product.id,
      productName: product.productName,
      confidence: 0,
      provenanceIds: [],
      sections: [
        {
          title: "Who is using it?",
          text: "No stored evidence or sales records identify users yet."
        },
        {
          title: "Sales opportunity",
          text: "Import reviewed evidence or sales records before generating recommendations."
        }
      ]
    };
  }

  const institutions = topCounts(evidence.map((record) => record.institution).filter(Boolean));
  const authors = topCounts(evidence.flatMap((record) => record.authors || []));
  const contexts = topCounts(evidence.map((record) => record.contextLabel));
  const sourceTypes = topCounts(evidence.map((record) => record.sourceType));
  const diseaseAreas = topCounts(evidence.flatMap((record) => record.diseaseAreas || []));
  const competitors = topCounts(evidence.flatMap((record) => {
    return (record.competitorMentions || []).map((mention) => mention.competitorName);
  }));

  return {
    productId: product.id,
    productName: product.productName,
    confidence: round(confidence),
    provenanceIds,
    salesRecordIds: salesRecords.map((record) => record.id),
    sections: [
      {
        title: "Who is using it?",
        text: institutions.length
          ? `${formatTop(institutions)} appear most often in stored evidence. ${authors.length ? `Frequent authors include ${formatTop(authors)}.` : ""}`.trim()
          : "Stored evidence has product mentions but no institution names."
      },
      {
        title: "Usage context",
        text: `${formatTop(sourceTypes) || "Stored records"} indicate use in ${formatTop(diseaseAreas) || "unspecified disease areas"}. Citation contexts are mainly ${formatTop(contexts) || "unclear"}.`
      },
      {
        title: "Most active institutions",
        text: institutions.length
          ? institutions.map((item) => `${item.label} (${item.count})`).join(", ")
          : "No institution-level activity has been stored."
      },
      {
        title: "Competitor products",
        text: competitors.length
          ? `${formatTop(competitors)} appear in the same stored evidence set.`
          : "No competitor product mentions are present in stored evidence."
      },
      {
        title: "Sales opportunities",
        text: leads.length
          ? leads.map((lead) => `${lead.institution}: ${lead.recommendedAction}`).join(" ")
          : "No lead score can be generated until product evidence or sales records are stored."
      }
    ]
  };
}

function topCounts(values, limit = 3) {
  const counts = new Map();
  for (const value of values.map((item) => String(item || "").trim()).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function formatTop(items) {
  return items.map((item) => item.label).join(", ");
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
