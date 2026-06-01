const VALID_SUPPORT = new Set(["supports", "contradicts", "mixed", "context"]);

const VALID_EVIDENCE_TYPES = new Set([
  "genetic_association",
  "functional",
  "model_system",
  "perturbation",
  "reagent",
  "technology",
  "safety",
  "other"
]);

/**
 * @param {unknown} input
 * @returns {{records: import("../domain/types.js").EvidenceRecord[], errors: string[]}}
 */
export function parseEvidenceInput(input) {
  const rawRecords = Array.isArray(input) ? input : [input];
  const records = [];
  const errors = [];

  rawRecords.forEach((record, index) => {
    const result = validateEvidenceRecord(record, index);
    if (result.error) {
      errors.push(result.error);
      return;
    }
    records.push(result.record);
  });

  return { records, errors };
}

/**
 * @param {unknown} record
 * @param {number} index
 * @returns {{record: import("../domain/types.js").EvidenceRecord, error?: never} | {record?: never, error: string}}
 */
export function validateEvidenceRecord(record, index = 0) {
  if (!isObject(record)) {
    return fail(index, "record must be an object");
  }

  const id = asTrimmedString(record.id);
  const evidenceType = asTrimmedString(record.evidenceType);
  const claim = asTrimmedString(record.claim);
  const supports = asTrimmedString(record.supports);

  if (!id) return fail(index, "id is required");
  if (!VALID_EVIDENCE_TYPES.has(evidenceType)) return fail(index, "evidenceType is invalid or missing");
  if (!claim) return fail(index, "claim is required");
  if (!VALID_SUPPORT.has(supports)) return fail(index, "supports must be supports, contradicts, mixed, or context");
  if (typeof record.confidence !== "number" || Number.isNaN(record.confidence)) {
    return fail(index, "confidence must be a number from 0 to 1");
  }
  if (record.confidence < 0 || record.confidence > 1) {
    return fail(index, "confidence must be between 0 and 1");
  }
  if (!isObject(record.source)) return fail(index, "source provenance is required");

  const title = asTrimmedString(record.source.title);
  const url = asTrimmedString(record.source.url);
  const citation = asTrimmedString(record.source.citation);
  const accessedAt = asTrimmedString(record.source.accessedAt);

  if (!title) return fail(index, "source.title is required");
  if (!url && !citation) return fail(index, "source.url or source.citation is required");
  if (!accessedAt) return fail(index, "source.accessedAt is required");
  if (!isObject(record.entities)) return fail(index, "entities are required");

  const entities = cleanEntities(record.entities);
  if (Object.keys(entities).length === 0) {
    return fail(index, "entities must include at least one named entity");
  }

  return {
    record: {
      id,
      source: {
        title,
        url: url || undefined,
        citation: citation || undefined,
        accessedAt,
        database: asTrimmedString(record.source.database) || undefined,
        recordId: asTrimmedString(record.source.recordId) || undefined
      },
      evidenceType,
      claim,
      supports,
      confidence: record.confidence,
      entities,
      notes: asTrimmedString(record.notes) || undefined,
      purchase: cleanPurchase(record.purchase)
    }
  };
}

function fail(index, message) {
  return { error: `Evidence record ${index + 1}: ${message}.` };
}

function cleanEntities(entities) {
  const cleaned = {};
  for (const key of ["gene", "disease", "modelSystem", "perturbation", "reagent", "technology"]) {
    const value = asTrimmedString(entities[key]);
    if (value) cleaned[key] = value;
  }
  return cleaned;
}

function cleanPurchase(purchase) {
  if (!isObject(purchase)) return undefined;
  const cleaned = {};
  for (const key of ["vendor", "catalogNumber", "url"]) {
    const value = asTrimmedString(purchase[key]);
    if (value) cleaned[key] = value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}
