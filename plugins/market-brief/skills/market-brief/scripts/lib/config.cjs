"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {readJson, writeJson, sha256, normalizeAddress} = require("./util.cjs");

const SKILL_DIR = path.resolve(__dirname, "..", "..");
const REFERENCES = path.join(SKILL_DIR, "references");

function loadConfig(file) {
  return readJson(file ? path.resolve(file) : path.join(REFERENCES, "config.json"));
}

function scopeList(value, config) {
  const all = Object.keys(config.scopes);
  if (!value || value === true || value === "both" || value === "all") return all;
  const list = String(value).split(",").map(s => s.trim()).filter(Boolean);
  for (const scope of list) if (!config.scopes[scope]) throw new Error(`Unknown scope "${scope}". Use ${all.join(", ")} or both.`);
  return list;
}

function resolveDataDir(args, config) {
  return path.resolve(args.data || process.env.MARKET_BRIEF_DATA || config.dataDirDefault);
}

function loadPreferences(dataDir) {
  const own = path.join(dataDir, "preferences.json");
  if (fs.existsSync(own)) return {source: own, preferences: readJson(own)};
  return {source: path.join(REFERENCES, "preferences.default.json"), preferences: readJson(path.join(REFERENCES, "preferences.default.json"))};
}

// Exact display exclusions per scope: Solana keeps case, EVM chains compare lowercase.
function hiddenMap(preferences, scopeCfg) {
  const map = new Map();
  for (const entry of preferences.hidden || []) {
    const id = String(entry.id || "");
    const sep = id.indexOf(":");
    if (sep < 0) throw new Error(`Hidden entry needs a chain-prefixed id: ${id}`);
    const chain = id.slice(0, sep);
    if (chain !== scopeCfg.chain) continue;
    map.set(`${chain}:${normalizeAddress(id.slice(sep + 1), scopeCfg.caseSensitive)}`, entry);
  }
  return map;
}

function loadExcludedAssets(scopeCfg) {
  const data = readJson(path.join(REFERENCES, "excluded-base-assets.json"));
  const map = new Map();
  for (const asset of data.assets) {
    if (asset.chain !== scopeCfg.chain) continue;
    map.set(`${asset.chain}:${normalizeAddress(asset.address, scopeCfg.caseSensitive)}`, asset);
  }
  return map;
}

function runPaths(runDir, scope) {
  return {
    run: path.join(runDir, "run.json"),
    budget: path.join(runDir, "budget.json"),
    discovery: path.join(runDir, `discovery-${scope}.json`),
    raw: path.join(runDir, "raw", `pairs-${scope}.json`),
    observations: path.join(runDir, `observations-${scope}.json`),
    evidence: path.join(runDir, `evidence-${scope}.json`),
    digest: path.join(runDir, "work", `research-input-${scope}.md`), // written as research-input-<scope>-N.md parts
    workText: path.join(runDir, "work", "text"),
    research: path.join(runDir, `research-${scope}.json`),
    comparison: path.join(runDir, `comparison-${scope}.json`),
    briefJson: path.join(runDir, `brief-${scope}.json`),
    briefMd: path.join(runDir, `brief-${scope}.md`),
    briefHtml: path.join(runDir, `brief-${scope}.html`),
    widget: path.join(runDir, `widget-${scope}.html`),
    coverage: path.join(runDir, "coverage.json"),
    readme: path.join(runDir, "README.md"),
  };
}

// Budget ledger shared by every step of one run.
function openBudget(runDir, config) {
  const file = path.join(runDir, "budget.json");
  const state = readJson(file, {limits: config.budget, used: {}});
  const save = () => writeJson(file, state);
  const used = key => state.used[key] || 0;
  return {
    state,
    used,
    take(key, limit) {
      const max = limit !== undefined ? limit : state.limits[key];
      if (max !== undefined && used(key) >= max) return false;
      state.used[key] = used(key) + 1;
      save();
      return true;
    },
    add(key, n = 1) { state.used[key] = used(key) + n; save(); },
  };
}

function configHash(config) {
  return sha256(config).slice(0, 16);
}

function compatibilityKey(scope, scopeCfg, config) {
  return sha256({scope, discoveryUrl: scopeCfg.discoveryUrl, schemaVersion: config.schemaVersion}).slice(0, 16);
}

module.exports = {
  SKILL_DIR, REFERENCES, loadConfig, scopeList, resolveDataDir, loadPreferences, hiddenMap, loadExcludedAssets,
  runPaths, openBudget, configHash, compatibilityKey,
};
