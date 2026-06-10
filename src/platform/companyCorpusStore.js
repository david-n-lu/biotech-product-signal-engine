import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  companyCorpusStats,
  exportCompanyCorpusCsv,
  importCompanyCorpusCsvText
} from "./companyCorpus.js";

export function createCompanyCorpusStore(filePath, options = {}) {
  const legacyPaths = options.legacyPaths || [];
  return {
    filePath,
    async listRecords(filters = {}) {
      return filterRecords(await readCorpus(filePath, legacyPaths), filters);
    },
    async upsertRecords(records = []) {
      const existing = await readCorpus(filePath, legacyPaths);
      const merged = mergeById(existing, records);
      await writeCorpus(filePath, merged);
      return {
        saved: records.length,
        total: merged.length,
        stats: companyCorpusStats(merged),
        filePath
      };
    },
    async exportCsv(filters = {}) {
      return exportCompanyCorpusCsv(filterRecords(await readCorpus(filePath, legacyPaths), filters));
    },
    async stats(filters = {}) {
      const records = await readCorpus(filePath, legacyPaths);
      const filtered = filterRecords(records, filters);
      return {
        ...companyCorpusStats(filtered),
        byConnector: connectorStats(records),
        filePath
      };
    }
  };
}

async function readCorpus(filePath, legacyPaths = []) {
  try {
    return await readCorpusFile(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const legacyRecords = [];
    for (const legacyPath of legacyPaths) {
      try {
        legacyRecords.push(...await readCorpusFile(legacyPath));
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") throw legacyError;
      }
    }
    return mergeById([], legacyRecords);
  }
}

async function readCorpusFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const parsed = importCompanyCorpusCsvText(text);
  if (parsed.errors.length) {
    throw new Error(parsed.errors.join(" "));
  }
  return parsed.records;
}

async function writeCorpus(filePath, records) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, exportCompanyCorpusCsv(records), "utf8");
}

function mergeById(existing, incoming) {
  const byId = new Map((existing || []).map((record) => [record.id, record]));
  for (const record of incoming || []) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function filterRecords(records, filters = {}) {
  const connectorIds = normalizeConnectorIds(filters.connectorIds || filters.connectorId);
  if (!connectorIds.length) return records;
  const allowed = new Set(connectorIds);
  return records.filter((record) => allowed.has(record.connectorId));
}

function connectorStats(records) {
  const grouped = new Map();
  for (const record of records || []) {
    const connectorId = record.connectorId || "unknown";
    if (!grouped.has(connectorId)) grouped.set(connectorId, []);
    grouped.get(connectorId).push(record);
  }
  return [...grouped.entries()]
    .map(([connectorId, connectorRecords]) => ({
      connectorId,
      ...companyCorpusStats(connectorRecords)
    }))
    .sort((a, b) => a.connectorId.localeCompare(b.connectorId));
}

function normalizeConnectorIds(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value);
  if (!text || text === "all") return [];
  return text.split(/[;,|]/).map(clean).filter(Boolean);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
