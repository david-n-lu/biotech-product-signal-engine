export function europePmcSentencesText(record) {
  const explicit = record?.europePmcSentences || record?.rawPayload?.europePmcSentences || "";
  if (containsGeneCopoeia(explicit)) return explicit;
  if (!isEuropePmcRecord(record)) return "";
  return legacyEuropePmcSnippet(record?.snippet);
}

export function hasEuropePmcCompanyContext(record) {
  if (!isEuropePmcRecord(record)) return true;
  return containsGeneCopoeia(europePmcSentencesText(record));
}

export function isEuropePmcRecord(record) {
  return record?.connectorId === "europepmc_fulltext_publications"
    || /europepmc\.org/i.test(record?.sourceUrl || "")
    || /^Europe PMC:/i.test(record?.sourceTitle || "");
}

function legacyEuropePmcSnippet(snippet) {
  const text = String(snippet || "")
    .replace(/^Europe PMC matched .*? in publication metadata or searchable full text\.\s*/i, "")
    .replace(/^Europe PMC nearby context matched .*? within two sentences of GeneCopoeia\.\s*/i, "")
    .replace(/^Europe PMC matched .*?\.\s*/i, "")
    .trim();
  return containsGeneCopoeia(text) ? text : "";
}

function containsGeneCopoeia(value) {
  return /\bGene\s*Copoeia\b/i.test(String(value || ""));
}
