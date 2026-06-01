import { parseEvidenceInput } from "./validation.js";

/**
 * Parses evidence supplied directly by the scientist. This connector does not
 * reach out to external databases, so it cannot invent or silently enrich data.
 *
 * @param {string} text
 * @returns {{records: import("../domain/types.js").EvidenceRecord[], errors: string[]}}
 */
export function importEvidenceFromJson(text) {
  if (!text.trim()) {
    return { records: [], errors: ["Paste an evidence object or array before importing."] };
  }

  try {
    return parseEvidenceInput(JSON.parse(text));
  } catch (error) {
    return { records: [], errors: [`Evidence JSON could not be parsed: ${error.message}`] };
  }
}

/**
 * @param {import("../domain/types.js").EvidenceRecord[]} existing
 * @param {import("../domain/types.js").EvidenceRecord[]} incoming
 * @returns {import("../domain/types.js").EvidenceRecord[]}
 */
export function mergeEvidence(existing, incoming) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) {
    byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
