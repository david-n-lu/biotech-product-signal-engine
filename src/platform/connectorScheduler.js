import { createConnectorConfigs, runSourceConnectors } from "./sourceConnectors.js";
import { linkCompanyCorpusRecordsToProducts } from "./companyCorpus.js";

export function createConnectorScheduler(repository, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const companyCorpusStore = options.companyCorpusStore;
  let connectors = createConnectorConfigs(options.connectors || []);
  const timers = new Map();
  const runs = [];

  const api = {
    start() {
      stopTimers();
      for (const connector of connectors.filter((item) => item.enabled)) {
        schedule(connector);
      }
    },
    stop() {
      stopTimers();
    },
    list() {
      return {
        connectors: clone(connectors),
        runs: clone(runs.slice(-20).reverse())
      };
    },
    update(id, patch) {
      const index = connectors.findIndex((connector) => connector.id === id);
      if (index < 0) throw httpError(404, `Connector ${id} was not found.`);
      connectors[index] = {
        ...connectors[index],
        enabled: patch.enabled ?? connectors[index].enabled,
        intervalMinutes: Number(patch.intervalMinutes || connectors[index].intervalMinutes),
        endpointUrl: patch.endpointUrl ?? connectors[index].endpointUrl
      };
      this.start();
      return clone(connectors[index]);
    },
    async run(connectorIds = [], productIds = [], runOptions = {}) {
      const now = new Date();
      const state = repository.snapshot();
      const products = productIds.length
        ? state.products.filter((product) => productIds.includes(product.id))
        : state.products;
      const selected = connectorIds.length
        ? connectors.filter((connector) => connectorIds.includes(connector.id))
        : connectors.filter((connector) => connector.enabled);

      if (selected.length === 0) {
        const run = {
          id: `RUN-${runs.length + 1}`,
          connectorIds,
          searchMode: runOptions.searchMode || "standard",
          startedAt: now.toISOString(),
          finishedAt: now.toISOString(),
          imported: 0,
          errors: ["No enabled connectors selected."],
          status: "warning"
        };
        runs.push(run);
        return clone(run);
      }

      const result = await runSourceConnectors({
        connectors: selected,
        products,
        connectorIds: selected.map((connector) => connector.id),
        fetchImpl,
        now,
        perProductLimit: runOptions.perProductLimit ?? options.perProductLimit,
        searchMode: runOptions.searchMode || "standard"
      });
      const corpusSave = await saveCompanyCorpus(result.corpusRecords || []);
      const corpusLinked = await linkCompanyCorpus(products, now, corpusSave.connectorIds || []);
      const recordsToIngest = dedupeRecords([
        ...result.records,
        ...corpusLinked.records
      ]);
      const ingest = recordsToIngest.length
        ? repository.ingestEvidence(recordsToIngest, "source_connectors")
        : { imported: 0, errors: [] };
      const finishedAt = new Date();
      const errors = [...result.errors, ...(corpusSave.errors || []), ...(corpusLinked.errors || []), ...(ingest.errors || [])];
      const notices = result.notices || [];
      const run = {
        id: `RUN-${runs.length + 1}`,
        connectorIds: selected.map((connector) => connector.id),
        searchMode: runOptions.searchMode || "standard",
        startedAt: now.toISOString(),
        finishedAt: finishedAt.toISOString(),
        imported: ingest.imported || 0,
        corpusSaved: corpusSave.saved || 0,
        corpusTotal: corpusSave.total || 0,
        corpusLinked: corpusLinked.records.length,
        corpusPath: corpusSave.filePath || "",
        errors,
        notices,
        connectorRuns: result.runs,
        status: errors.length ? "warning" : "success"
      };
      runs.push(run);
      updateConnectorRunState(selected, run, finishedAt, result.runs);
      return clone(run);
    }
  };

  return api;

  function schedule(connector) {
    const intervalMs = Math.max(1, Number(connector.intervalMinutes) || 1440) * 60000;
    connector.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    const timer = setInterval(() => {
      api.run([connector.id]).catch(() => undefined);
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    timers.set(connector.id, timer);
  }

  function stopTimers() {
    for (const timer of timers.values()) clearInterval(timer);
    timers.clear();
  }

  function updateConnectorRunState(selected, run, finishedAt, connectorRuns = []) {
    for (const selectedConnector of selected) {
      const index = connectors.findIndex((connector) => connector.id === selectedConnector.id);
      if (index < 0) continue;
      const connectorRun = connectorRuns.find((item) => item.connectorId === selectedConnector.id) || {
        imported: 0,
        errors: [],
        notices: []
      };
      const intervalMs = Math.max(1, Number(connectors[index].intervalMinutes) || 1440) * 60000;
      connectors[index] = {
        ...connectors[index],
        lastRunAt: finishedAt.toISOString(),
        nextRunAt: connectors[index].enabled ? new Date(finishedAt.getTime() + intervalMs).toISOString() : "",
        lastStatus: connectorRun.errors.length ? "warning" : "success",
        lastImported: connectorRun.imported,
        lastErrors: connectorRun.errors,
        lastNotices: connectorRun.notices || []
      };
    }
  }

  async function saveCompanyCorpus(records) {
    if (!companyCorpusStore || !records.length) {
      return { saved: 0, total: 0, errors: [] };
    }
    try {
      return {
        errors: [],
        connectorIds: unique(records.map((record) => record.connectorId).filter(Boolean)),
        ...await companyCorpusStore.upsertRecords(records)
      };
    } catch (error) {
      return {
        saved: 0,
        total: 0,
        errors: [`Company corpus save failed: ${error.message}`]
      };
    }
  }

  async function linkCompanyCorpus(productsToLink, now, connectorIds = []) {
    if (!companyCorpusStore || !productsToLink.length) return { records: [], errors: [] };
    try {
      const corpusRecords = await companyCorpusStore.listRecords({ connectorIds });
      return {
        records: linkCompanyCorpusRecordsToProducts(corpusRecords, productsToLink, { now }),
        errors: []
      };
    } catch (error) {
      return {
        records: [],
        errors: [`Company corpus relink failed: ${error.message}`]
      };
    }
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function dedupeRecords(records) {
  return [...new Map((records || []).map((record) => [record.id, record])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}

function unique(values) {
  return [...new Set(values)];
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
