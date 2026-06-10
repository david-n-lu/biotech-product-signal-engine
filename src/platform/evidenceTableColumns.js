export const EVIDENCE_TABLE_HEADERS = Object.freeze([
  "Source",
  "Date",
  "Institution",
  "Products",
  "Context",
  "Europe PMC sentences",
  "Review",
  "Confidence",
  "Actions",
  "Provenance"
]);

export function evidenceTableHeaders() {
  return [...EVIDENCE_TABLE_HEADERS];
}
