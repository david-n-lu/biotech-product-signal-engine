const LABELS = new Set([
  "core_method",
  "secondary_mention",
  "comparison",
  "negative_mention",
  "unclear"
]);

const RULES = [
  {
    label: "negative_mention",
    confidence: 0.86,
    patterns: [
      /\bfailed\b/i,
      /\bno signal\b/i,
      /\bnot detect(?:ed)?\b/i,
      /\blow specificity\b/i,
      /\bpoor performance\b/i,
      /\bbatch variability\b/i,
      /\bnegative result\b/i
    ]
  },
  {
    label: "comparison",
    confidence: 0.82,
    patterns: [
      /\bcompared (?:with|to)\b/i,
      /\bversus\b/i,
      /\bvs\.\b/i,
      /\balternative to\b/i,
      /\bhead-to-head\b/i,
      /\boutperformed\b/i,
      /\bbenchmark(?:ed)?\b/i
    ]
  },
  {
    label: "core_method",
    confidence: 0.78,
    patterns: [
      /\bmethods?\b/i,
      /\bused\b/i,
      /\bperformed\b/i,
      /\btransfect(?:ed|ion)\b/i,
      /\bknock(?:out|down)\b/i,
      /\breporter assay\b/i,
      /\baccording to the protocol\b/i,
      /\bmaterials and methods\b/i
    ]
  },
  {
    label: "secondary_mention",
    confidence: 0.64,
    patterns: [
      /\bsupplementary\b/i,
      /\bmentioned\b/i,
      /\bcatalog\b/i,
      /\bprovided by\b/i,
      /\bavailable from\b/i,
      /\breferenced\b/i
    ]
  }
];

export function classifyCitationContext(text) {
  const snippet = String(text || "");
  for (const rule of RULES) {
    const matched = rule.patterns.find((pattern) => pattern.test(snippet));
    if (matched) {
      return {
        label: rule.label,
        confidence: rule.confidence,
        reasons: [`Matched context phrase ${matched.source}.`]
      };
    }
  }

  return {
    label: "unclear",
    confidence: 0.35,
    reasons: ["No high-confidence citation-context rule matched."]
  };
}

export function normalizeContextLabel(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LABELS.has(normalized) ? normalized : "unclear";
}

export const citationContextLabels = [...LABELS];
