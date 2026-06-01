export const hypothesis = {
  gene: "GENE1",
  disease: "Disease A",
  goal: "Prioritize a tractable model."
};

export const associationEvidence = {
  id: "EV-1",
  source: {
    title: "Curated association record",
    url: "https://example.org/association",
    accessedAt: "2026-05-25"
  },
  evidenceType: "genetic_association",
  claim: "GENE1 is associated with Disease A in the imported dataset.",
  supports: "supports",
  confidence: 0.8,
  entities: {
    gene: "GENE1",
    disease: "Disease A"
  }
};

export const modelEvidence = {
  id: "EV-2",
  source: {
    title: "Curated model record",
    citation: "Scientist supplied model evidence",
    accessedAt: "2026-05-25"
  },
  evidenceType: "model_system",
  claim: "Patient-derived neurons model a relevant phenotype.",
  supports: "supports",
  confidence: 0.7,
  entities: {
    gene: "GENE1",
    disease: "Disease A",
    modelSystem: "Patient-derived neurons"
  }
};

export const perturbationEvidence = {
  id: "EV-3",
  source: {
    title: "Curated perturbation record",
    citation: "Scientist supplied perturbation evidence",
    accessedAt: "2026-05-25"
  },
  evidenceType: "perturbation",
  claim: "CRISPR interference is feasible for the target in this model.",
  supports: "supports",
  confidence: 0.65,
  entities: {
    gene: "GENE1",
    disease: "Disease A",
    perturbation: "CRISPRi knockdown"
  }
};

export const reagentEvidence = {
  id: "EV-4",
  source: {
    title: "Curated reagent record",
    url: "https://example.org/reagent",
    accessedAt: "2026-05-25"
  },
  evidenceType: "reagent",
  claim: "A validated guide reagent is available for the target.",
  supports: "supports",
  confidence: 0.6,
  entities: {
    gene: "GENE1",
    disease: "Disease A",
    reagent: "GENE1 CRISPRi guide set",
    technology: "CRISPRi"
  },
  purchase: {
    vendor: "Example Vendor",
    catalogNumber: "EV-G1-KD",
    url: "https://example.org/reagent"
  }
};
