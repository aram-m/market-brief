"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {readJson} = require("./util.cjs");

function listRunDirs(reportsRoot) {
  if (!fs.existsSync(reportsRoot)) return [];
  const out = [];
  for (const day of fs.readdirSync(reportsRoot).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    const dayDir = path.join(reportsRoot, day);
    for (const run of fs.readdirSync(dayDir)) {
      const dir = path.join(dayDir, run);
      if (fs.existsSync(path.join(dir, "run.json"))) out.push(dir);
    }
  }
  return out;
}

// Latest earlier Claude run of the same scope with the same discovery URL and schema.
function findPrior({reportsRoot, scope, current}) {
  let best = null;
  for (const dir of listRunDirs(reportsRoot)) {
    const run = readJson(path.join(dir, "run.json"), null);
    if (!run || run.runId === current.runId || !String(run.producer || "").startsWith("claude")) continue;
    const obsFile = path.join(dir, `observations-${scope}.json`);
    if (!fs.existsSync(obsFile)) continue;
    const obs = readJson(obsFile, null);
    if (!obs || obs.compatibilityKey !== current.compatibilityKey || obs.marketStatus === "failed") continue;
    const at = obs.metrics && obs.metrics.window && obs.metrics.window.to;
    if (!at || Date.parse(at) >= Date.parse(current.metrics.window.to)) continue;
    if (!best || Date.parse(at) > Date.parse(best.at)) best = {dir, at, obs, run};
  }
  return best;
}

function compareScans({reportsRoot, current, hidden}) {
  const prior = findPrior({reportsRoot, scope: current.scope, current});
  if (!prior) {
    return {scope: current.scope, prior: null, reason: "no compatible prior Claude scan (same scope, discovery URL and schema) is available", newlySurfaced: [], noLongerQualifying: [], priorByToken: {}};
  }
  const eligible = rows => rows.filter(r => !hidden.has(r.id));
  const now = eligible(current.rows);
  const before = eligible(prior.obs.rows);
  const beforeIds = new Set(before.map(r => r.id));
  const nowIds = new Set(now.map(r => r.id));
  const priorByToken = {};
  for (const r of before) priorByToken[r.id] = {observedAt: prior.at, volume24h: r.volume24h.value, change24h: r.change24h, pools: r.pools.length};
  return {
    scope: current.scope,
    prior: {runId: prior.run.runId, path: path.relative(reportsRoot, prior.dir), observedAt: prior.at, discoveredPools: prior.obs.counts.discoveredPools},
    current: {runId: current.runId, observedAt: current.metrics.window.to, discoveredPools: current.counts.discoveredPools},
    newlySurfaced: now.filter(r => !beforeIds.has(r.id)).map(r => ({id: r.id, name: r.name, symbol: r.symbol})),
    noLongerQualifying: before.filter(r => !nowIds.has(r.id)).map(r => ({id: r.id, name: r.name, symbol: r.symbol})),
    priorByToken,
    note: "Membership changes reflect the discovery page only; they do not establish a launch, delisting or chain-wide flow.",
  };
}

module.exports = {compareScans, findPrior, listRunDirs};
