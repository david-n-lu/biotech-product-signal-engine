import { createConnectorConfigs, runSourceConnectors } from "./sourceConnectors.js";

export function createConnectorScheduler(repository, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
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
      const ingest = result.records.length
        ? repository.ingestEvidence(result.records, "source_connectors")
        : { imported: 0, errors: [] };
      const finishedAt = new Date();
      const errors = [...result.errors, ...(ingest.errors || [])];
      const notices = result.notices || [];
      const run = {
        id: `RUN-${runs.length + 1}`,
        connectorIds: selected.map((connector) => connector.id),
        searchMode: runOptions.searchMode || "standard",
        startedAt: now.toISOString(),
        finishedAt: finishedAt.toISOString(),
        imported: ingest.imported || 0,
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
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
