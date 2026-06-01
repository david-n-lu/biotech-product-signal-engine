import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAlphaFoldPredictionUrl,
  buildClinVarSearchUrl,
  buildPubMedSearchUrl,
  buildUniProtSearchUrl,
  searchEvidenceSources
} from "../src/evidence/externalSearch.js";

test("external search URL builders target the expected primary APIs", () => {
  assert.equal(new URL(buildPubMedSearchUrl("GENE1", "Disease A", 3)).hostname, "eutils.ncbi.nlm.nih.gov");
  assert.match(new URL(buildClinVarSearchUrl("GENE1", "Disease A", 3)).searchParams.get("term"), /GENE1\[gene\]/);
  assert.equal(new URL(buildUniProtSearchUrl("GENE1", 3)).hostname, "rest.uniprot.org");
  assert.equal(buildAlphaFoldPredictionUrl("P12345"), "https://alphafold.ebi.ac.uk/api/prediction/P12345");
});

test("PubMed hits import as low-confidence contextual evidence with provenance", async () => {
  const fetchImpl = mockFetch({
    pubmedIds: ["123"],
    pubmedSummaries: {
      result: {
        uids: ["123"],
        "123": {
          title: "GENE1 Disease A study",
          fulljournalname: "Example Journal",
          pubdate: "2026",
          authors: [{ name: "Curator A" }]
        }
      }
    }
  });

  const result = await searchEvidenceSources({
    gene: "GENE1",
    disease: "Disease A",
    sources: ["pubmed"],
    fetchImpl,
    now: new Date("2026-05-25T12:00:00Z")
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.records[0].id, "PUBMED:123");
  assert.equal(result.records[0].supports, "context");
  assert.equal(result.records[0].confidence, 0.25);
  assert.equal(result.records[0].source.url, "https://pubmed.ncbi.nlm.nih.gov/123/");
});

test("ClinVar hits import as contextual genetic-association candidates", async () => {
  const fetchImpl = mockFetch({
    clinvarIds: ["456"],
    clinvarSummaries: {
      result: {
        uids: ["456"],
        "456": {
          title: "GENE1 variant and Disease A",
          germline_classification: { description: "Pathogenic" },
          variation_type: "single nucleotide variant"
        }
      }
    }
  });

  const result = await searchEvidenceSources({
    gene: "GENE1",
    disease: "Disease A",
    sources: ["clinvar"],
    fetchImpl,
    now: new Date("2026-05-25T12:00:00Z")
  });

  assert.equal(result.records[0].id, "CLINVAR:456");
  assert.equal(result.records[0].evidenceType, "genetic_association");
  assert.equal(result.records[0].supports, "context");
  assert.match(result.records[0].claim, /reported classification: Pathogenic/);
});

test("UniProt and AlphaFold searches preserve structure provenance without disease overclaiming", async () => {
  const fetchImpl = mockFetch({
    uniprotResults: {
      results: [{
        primaryAccession: "P12345",
        uniProtkbId: "GENE1_HUMAN",
        proteinDescription: {
          recommendedName: { fullName: { value: "Gene 1 protein" } }
        },
        genes: [{ geneName: { value: "GENE1" } }],
        organism: { scientificName: "Homo sapiens" },
        uniProtKBCrossReferences: [{ database: "AlphaFoldDB", id: "AF-P12345-F1" }]
      }]
    },
    alphafoldPredictions: [{
      entryId: "AF-P12345-F1",
      uniprotDescription: "Gene 1 protein",
      organismScientificName: "Homo sapiens",
      cifUrl: "https://example.org/model.cif",
      pdbUrl: "https://example.org/model.pdb"
    }]
  });

  const result = await searchEvidenceSources({
    gene: "GENE1",
    disease: "Disease A",
    sources: ["uniprot", "alphafold"],
    fetchImpl,
    now: new Date("2026-05-25T12:00:00Z")
  });

  assert.deepEqual(result.records.map((record) => record.id), [
    "ALPHAFOLD:AF-P12345-F1",
    "UNIPROT:P12345"
  ]);
  assert.equal(result.records[0].evidenceType, "technology");
  assert.match(result.records[0].claim, /structural context, not disease evidence/);
  assert.equal(result.records[1].source.url, "https://www.uniprot.org/uniprotkb/P12345/entry");
});

test("external search refuses to run without a gene", async () => {
  const result = await searchEvidenceSources({
    gene: "",
    disease: "Disease A",
    sources: ["pubmed"],
    fetchImpl: mockFetch({})
  });

  assert.equal(result.records.length, 0);
  assert.match(result.errors[0], /Enter a gene/);
});

function mockFetch(data) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "pubmed") {
      if (parsed.pathname.endsWith("/esearch.fcgi")) {
        return ok({ esearchresult: { idlist: data.pubmedIds || [] } });
      }
      return ok(data.pubmedSummaries || { result: { uids: [] } });
    }
    if (parsed.hostname === "eutils.ncbi.nlm.nih.gov" && parsed.searchParams.get("db") === "clinvar") {
      if (parsed.pathname.endsWith("/esearch.fcgi")) {
        return ok({ esearchresult: { idlist: data.clinvarIds || [] } });
      }
      return ok(data.clinvarSummaries || { result: { uids: [] } });
    }
    if (parsed.hostname === "rest.uniprot.org") {
      return ok(data.uniprotResults || { results: [] });
    }
    if (parsed.hostname === "alphafold.ebi.ac.uk") {
      return ok(data.alphafoldPredictions || []);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function ok(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}
