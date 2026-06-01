export function getEvidenceSourceLink(record) {
  const href = clean(record?.sourceUrl);
  const title = clean(record?.sourceTitle) || clean(record?.sourceId) || href || "Untitled source";
  const sourceType = sourceLabel(record?.sourceType);
  return {
    href,
    label: sourceType ? `${sourceType}: ${title}` : title,
    isEuropePmc: /europepmc\.org/i.test(href) || /^Europe PMC:/i.test(title)
  };
}

function sourceLabel(value) {
  return String(value || "").replace(/_/g, " ").trim();
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
