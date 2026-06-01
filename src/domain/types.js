/**
 * @typedef {"genetic_association" | "functional" | "model_system" | "perturbation" | "reagent" | "technology" | "safety" | "other"} EvidenceType
 */

/**
 * @typedef {Object} EvidenceSource
 * @property {string} title
 * @property {string=} url
 * @property {string=} citation
 * @property {string} accessedAt
 * @property {string=} database
 * @property {string=} recordId
 */

/**
 * @typedef {Object} EvidenceEntities
 * @property {string=} gene
 * @property {string=} disease
 * @property {string=} modelSystem
 * @property {string=} perturbation
 * @property {string=} reagent
 * @property {string=} technology
 */

/**
 * @typedef {Object} EvidenceRecord
 * @property {string} id
 * @property {EvidenceSource} source
 * @property {EvidenceType} evidenceType
 * @property {string} claim
 * @property {"supports" | "contradicts" | "mixed" | "context"} supports
 * @property {number} confidence
 * @property {EvidenceEntities} entities
 * @property {string=} notes
 * @property {Object=} purchase
 * @property {string=} purchase.vendor
 * @property {string=} purchase.catalogNumber
 * @property {string=} purchase.url
 */

/**
 * @typedef {Object} Hypothesis
 * @property {string} gene
 * @property {string} disease
 * @property {string} goal
 */

/**
 * @typedef {Object} Recommendation
 * @property {string} id
 * @property {string} title
 * @property {string} rationale
 * @property {number} confidence
 * @property {string[]} provenanceIds
 * @property {string[]} todos
 */

/**
 * Runtime no-op export that makes this module importable while keeping the
 * JSDoc typedefs centralized for editors and tests.
 */
export const domainTypesVersion = "0.1.0";
