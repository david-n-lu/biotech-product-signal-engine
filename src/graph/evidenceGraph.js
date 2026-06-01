/**
 * @param {import("../domain/types.js").EvidenceRecord[]} evidence
 */
export function buildEvidenceGraph(evidence) {
  const nodes = new Map();
  const edges = [];

  for (const record of evidence) {
    const evidenceNodeId = `evidence:${record.id}`;
    addNode(nodes, evidenceNodeId, "evidence", record.id, record.confidence);

    for (const [entityType, rawValue] of Object.entries(record.entities)) {
      const value = String(rawValue).trim();
      if (!value) continue;
      const entityNodeId = `${entityType}:${normalize(value)}`;
      addNode(nodes, entityNodeId, entityType, value, record.confidence);
      edges.push({
        id: `${record.id}:${entityNodeId}`,
        from: evidenceNodeId,
        to: entityNodeId,
        relation: record.supports,
        evidenceId: record.id,
        confidence: record.confidence
      });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges
  };
}

function addNode(nodes, id, type, label, confidence) {
  const existing = nodes.get(id);
  if (existing) {
    existing.evidenceCount += 1;
    existing.confidence = Math.max(existing.confidence, confidence);
    return;
  }
  nodes.set(id, {
    id,
    type,
    label,
    evidenceCount: 1,
    confidence
  });
}

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, "-");
}
