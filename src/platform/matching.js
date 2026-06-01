const CATALOGISH = /\b[A-Z]{1,5}[A-Z0-9]*[-_]?[A-Z0-9]{2,}(?:[-_][A-Z0-9]{1,8})*\b/g;
const RRID = /\bRRID:[A-Z]{1,8}_[A-Z0-9]+\b/gi;

export function searchProducts(query, products) {
  const term = normalizeText(query);
  const compactTerm = compact(query);
  if (!term) return [];

  return products
    .map((product) => {
      const reasons = [];
      let score = 0;

      if (normalizeText(product.company).includes(term)) {
        score += 0.62;
        reasons.push("company_name");
      }
      if (normalizeText(product.productName).includes(term)) {
        score += 0.92;
        reasons.push("product_name");
      }
      if (compact(product.catalogNumber) && compact(product.catalogNumber) === compactTerm) {
        score += 1;
        reasons.push("catalog_number");
      }
      if (compact(product.rrid) && compact(product.rrid) === compactTerm) {
        score += 1;
        reasons.push("rrid");
      }

      for (const synonym of product.synonyms || []) {
        const normalizedSynonym = normalizeText(synonym);
        if (normalizedSynonym.includes(term) || term.includes(normalizedSynonym)) {
          score += 0.82;
          reasons.push("synonym");
          break;
        }
        const similarity = diceCoefficient(term, normalizedSynonym);
        if (similarity >= 0.74) {
          score += 0.62 * similarity;
          reasons.push("fuzzy_synonym");
          break;
        }
      }

      return {
        product,
        score: clamp01(score),
        reasons: [...new Set(reasons)]
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.product.productName.localeCompare(b.product.productName));
}

export function matchProducts(products, text) {
  const haystack = normalizeText(text);
  const compactHaystack = compact(text);
  const matches = [];

  for (const product of products) {
    addPhraseMatch(matches, product, product.productName, "product_name", 0.98, haystack);
    addCompactMatch(matches, product, product.catalogNumber, "catalog_number", 0.99, compactHaystack);
    addCompactMatch(matches, product, product.rrid, "rrid", 0.99, compactHaystack);

    for (const synonym of product.synonyms || []) {
      addPhraseMatch(matches, product, synonym, "synonym", 0.9, haystack);
      const compactSynonym = compact(synonym);
      if (compactSynonym && compactHaystack.includes(compactSynonym) && !haystack.includes(normalizeText(synonym))) {
        matches.push({
          productId: product.id,
          productName: product.productName,
          matchedText: synonym,
          mentionType: "fuzzy_synonym",
          confidence: 0.84
        });
      }
      const fuzzyScore = bestFuzzyPhraseScore(haystack, normalizeText(synonym));
      if (fuzzyScore >= 0.82) {
        matches.push({
          productId: product.id,
          productName: product.productName,
          matchedText: synonym,
          mentionType: "fuzzy_synonym",
          confidence: round(0.78 * fuzzyScore)
        });
      }
    }

    const company = normalizeText(product.company);
    if (company && haystack.includes(company)) {
      matches.push({
        productId: product.id,
        productName: product.productName,
        matchedText: product.company,
        mentionType: "company_name",
        confidence: 0.42
      });
    }
  }

  return dedupeMatches(matches)
    .sort((a, b) => b.confidence - a.confidence || a.productName.localeCompare(b.productName));
}

export function matchCompetitors(products, text) {
  const haystack = normalizeText(text);
  const matches = [];

  for (const product of products) {
    for (const competitorName of product.competitorEquivalents || []) {
      const normalized = normalizeText(competitorName);
      if (normalized && haystack.includes(normalized)) {
        matches.push({
          productId: product.id,
          productName: product.productName,
          competitorName,
          matchedText: competitorName,
          confidence: 0.86
        });
      }
    }
  }

  return dedupeCompetitors(matches);
}

export function extractEntities(text) {
  const value = String(text || "");
  return {
    catalogNumbers: unique(value.match(CATALOGISH) || []),
    rrids: unique(value.match(RRID) || [])
  };
}

function addPhraseMatch(matches, product, phrase, mentionType, confidence, haystack) {
  const normalized = normalizeText(phrase);
  if (!normalized || normalized.length < 3) return;
  if (!haystack.includes(normalized)) return;
  matches.push({
    productId: product.id,
    productName: product.productName,
    matchedText: phrase,
    mentionType,
    confidence
  });
}

function addCompactMatch(matches, product, value, mentionType, confidence, compactHaystack) {
  const normalized = compact(value);
  if (!normalized) return;
  if (!compactHaystack.includes(normalized)) return;
  matches.push({
    productId: product.id,
    productName: product.productName,
    matchedText: value,
    mentionType,
    confidence
  });
}

function bestFuzzyPhraseScore(haystack, needle) {
  const needleTokens = needle.split(" ").filter(Boolean);
  if (needleTokens.length === 0) return 0;
  const haystackTokens = haystack.split(" ").filter(Boolean);
  let best = 0;
  for (let index = 0; index <= haystackTokens.length - needleTokens.length; index += 1) {
    const phrase = haystackTokens.slice(index, index + needleTokens.length).join(" ");
    best = Math.max(best, diceCoefficient(phrase, needle));
  }
  return best;
}

function dedupeMatches(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const key = `${match.productId}:${match.mentionType}:${normalizeText(match.matchedText)}`;
    const existing = byKey.get(key);
    if (!existing || match.confidence > existing.confidence) {
      byKey.set(key, match);
    }
  }
  return [...byKey.values()];
}

function dedupeCompetitors(matches) {
  const byKey = new Map();
  for (const match of matches) {
    const key = `${match.productId}:${normalizeText(match.competitorName)}`;
    if (!byKey.has(key)) byKey.set(key, match);
  }
  return [...byKey.values()];
}

function diceCoefficient(a, b) {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0;
  const rightCounts = new Map();
  for (const item of right) rightCounts.set(item, (rightCounts.get(item) || 0) + 1);
  let overlap = 0;
  for (const item of left) {
    const count = rightCounts.get(item) || 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(item, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length);
}

function bigrams(value) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (normalized.length < 2) return normalized ? [normalized] : [];
  const grams = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    grams.push(normalized.slice(index, index + 2));
  }
  return grams;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
