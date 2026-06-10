import test from "node:test";
import assert from "node:assert/strict";
import { europePmcSentencesText, hasEuropePmcCompanyContext } from "../src/platform/europePmcSentences.js";

test("Europe PMC sentences prefer extracted nearby context", () => {
  const text = europePmcSentencesText({
    connectorId: "europepmc_fulltext_publications",
    europePmcSentences: "Cells used GeneCopoeia BI001 in the labeling step.",
    snippet: "Europe PMC matched GeneCopoeia BI001 in publication metadata or searchable full text. Legacy text."
  });

  assert.equal(text, "Cells used GeneCopoeia BI001 in the labeling step.");
});

test("Europe PMC sentences do not backfill synthetic legacy query prefixes", () => {
  const text = europePmcSentencesText({
    connectorId: "europepmc_fulltext_publications",
    sourceTitle: "Europe PMC: legacy record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    snippet: "Europe PMC matched GeneCopoeia PA001 in publication metadata or searchable full text. The legacy context remains visible."
  });

  assert.equal(text, "");
});

test("Europe PMC sentences keep real legacy context that still contains GeneCopoeia", () => {
  const record = {
    connectorId: "europepmc_fulltext_publications",
    sourceTitle: "Europe PMC: legacy record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    snippet: "Europe PMC nearby context matched PA001 within two sentences of GeneCopoeia. Cells used GeneCopoeia PA001 in the methods section."
  };

  assert.equal(europePmcSentencesText(record), "Cells used GeneCopoeia PA001 in the methods section.");
  assert.equal(hasEuropePmcCompanyContext(record), true);
});

test("Europe PMC company context rejects rows without real GeneCopoeia sentences", () => {
  assert.equal(hasEuropePmcCompanyContext({
    connectorId: "europepmc_fulltext_publications",
    sourceTitle: "Europe PMC: legacy record",
    sourceUrl: "https://europepmc.org/article/MED/1",
    snippet: "Europe PMC matched GeneCopoeia PA001 in publication metadata or searchable full text. The abstract only mentions a pathway."
  }), false);

  assert.equal(hasEuropePmcCompanyContext({
    connectorId: "europepmc_fulltext_publications",
    sourceTitle: "Europe PMC: legacy record",
    sourceUrl: "https://europepmc.org/article/MED/2",
    snippet: "Europe PMC matched GeneCopoeia PA001."
  }), false);
});

test("Europe PMC sentences remain blank for non-Europe PMC records", () => {
  assert.equal(europePmcSentencesText({
    connectorId: "pubmed_publications",
    snippet: "PubMed metadata matched GeneCopoeia BI001."
  }), "");
});
