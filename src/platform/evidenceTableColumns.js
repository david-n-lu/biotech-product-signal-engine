export const EVIDENCE_TABLE_HEADERS = Object.freeze([
  "Source",
  "Date",
  "Institution",
  "Products",
  "Context",
  "Review",
  "Confidence",
  "Actions",
  "Provenance"
]);

export function evidenceTableHeaders() {
  return [...EVIDENCE_TABLE_HEADERS];
}
