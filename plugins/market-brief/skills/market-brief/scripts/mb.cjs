#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const util = require("./lib/util.cjs");
const cfg = require("./lib/config.cjs");
const {buildDiscovery, extractionScript} = require("./lib/discovery.cjs");
const {fetchPairs} = require("./lib/metrics.cjs");
const {aggregate} = require("./lib/aggregate.cjs");
const {collectEvidence} = require("./lib/evidence.cjs");
const {measuredFacts} = require("./lib/measured.cjs");
const {researchDigest} = require("./lib/digest.cjs");
const {validateResearch} = require("./lib/research.cjs");
const {compareScans} = require("./lib/compare.cjs");
const {buildBrief, renderMarkdown, renderWidget, renderHtml} = require("./lib/render.cjs");
const {finalizeRun} = require("./lib/coverage.cjs");

const USAGE = `Market Brief pipeline (Node ${">="}18, no dependencies)

  mb.cjs init-data [--data DIR]                      create the data folder with preferences.json
  mb.cjs new-run [--data DIR] [--label daily] [--scopes sol,rh]
  mb.cjs discovery-script                            print the browser extraction script
  mb.cjs save-discovery --run DIR --scope sol --input FILE [--method NAME]
  mb.cjs collect --run DIR [--scope sol|rh|both]     pair API metrics, aggregation, comparison, list brief
  mb.cjs evidence --run DIR [--scope ...] [--id SYMBOL|ID,...]   primary reads and chain facts; --id for a deep dive on chosen rows
  mb.cjs validate --run DIR [--scope ...] [--all]    check research-<scope>.json; --all requires every displayed row
  mb.cjs render --run DIR [--scope ...]              Markdown, widget and HTML from observations plus any research
  mb.cjs finalize --run DIR                          coverage.json and README.md
  mb.cjs aggregate --run DIR --scope sol             recompute observations from saved raw responses

Data folder: --data, else $MARKET_BRIEF_DATA, else ./market-brief-data`;

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function fail(message, code = 1) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

function needRun(args) {
  if (!args.run) fail("--run DIR is required");
  const runDir = path.resolve(args.run);
  if (!fs.existsSync(path.join(runDir, "run.json"))) fail(`No run.json in ${runDir}`);
  return {runDir, run: util.readJson(path.join(runDir, "run.json"))};
}

function scopesFor(args, run, config) {
  return args.scope ? cfg.scopeList(args.scope, config) : run.scopes;
}

function reportsRootOf(runDir) {
  return path.resolve(runDir, "..", "..");
}

function dataDirOf(runDir, config) {
  return path.resolve(reportsRootOf(runDir), ...config.reportsPath.split("/").map(() => ".."));
}

function measuredMap(observations, evidence, comparison, config) {
  const map = {};
  for (const row of observations.rows.filter(r => !r.hidden)) {
    map[row.id] = measuredFacts(row, {
      metricsAt: observations.metrics.window.to,
      chainFacts: evidence && evidence.chainFacts ? evidence.chainFacts[row.id] : null,
      prior: comparison && comparison.priorByToken ? comparison.priorByToken[row.id] : null,
      recentPoolDays: config.research.recentPoolDays,
    });
  }
  return map;
}

function loadScope(runDir, scope) {
  const p = cfg.runPaths(runDir, scope);
  return {
    p,
    observations: util.readJson(p.observations, null),
    evidence: util.readJson(p.evidence, null),
    research: util.readJson(p.research, null),
    comparison: util.readJson(p.comparison, null),
  };
}

function renderScope({runDir, run, scope, config, stage}) {
  const scopeCfg = config.scopes[scope];
  const {p, observations, evidence, research, comparison} = loadScope(runDir, scope);
  if (!observations) {
    const discovery = util.readJson(p.discovery, null);
    const reason = discovery ? `discovery ${discovery.status}${discovery.reason ? `: ${discovery.reason}` : ""}` : "discovery not saved";
    const md = `**${scopeCfg.label}** — no current market data (${reason}). No earlier scan is shown in its place.\n`;
    util.writeText(p.briefMd, md);
    return {scope, stage, markdown: p.briefMd, rows: 0, unavailable: reason};
  }
  const effective = stage === "final" && !research ? "market" : stage;
  const measured = measuredMap(observations, evidence, comparison, config);
  const brief = buildBrief({scope, scopeCfg, config, run, observations, evidence, research, comparison, measuredByToken: measured, stage: effective});
  util.writeJson(p.briefJson, brief);
  util.writeText(p.briefMd, renderMarkdown(brief));
  util.writeText(p.widget, renderWidget(brief));
  util.writeText(p.briefHtml, renderHtml(brief));
  return {scope, stage: effective, markdown: p.briefMd, widget: p.widget, html: p.briefHtml, rows: brief.rows.length, widgetBytes: fs.statSync(p.widget).size};
}

const commands = {
  "init-data"(args, config) {
    const dataDir = cfg.resolveDataDir(args, config);
    fs.mkdirSync(path.join(dataDir, config.reportsPath), {recursive: true});
    const prefs = path.join(dataDir, "preferences.json");
    if (!fs.existsSync(prefs)) fs.copyFileSync(path.join(cfg.REFERENCES, "preferences.default.json"), prefs);
    const ignore = path.join(dataDir, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "# Local research text and worksheets are not published\n**/work/\n");
    out({dataDir, preferences: prefs});
  },

  "new-run"(args, config) {
    const dataDir = cfg.resolveDataDir(args, config);
    const scopes = cfg.scopeList(args.scopes || "both", config);
    const label = String(args.label || (scopes.length > 1 ? "daily" : scopes[0])).replace(/[^a-z0-9-]/gi, "");
    const now = new Date();
    const stamp = util.folderStamp(now, config.timezone);
    let name = `${stamp.time}-claude-${label}`;
    let runDir = path.join(dataDir, config.reportsPath, stamp.day, name);
    for (let n = 2; fs.existsSync(runDir); n++) runDir = path.join(dataDir, config.reportsPath, stamp.day, `${name}-${n}`);
    name = path.basename(runDir);
    const {source, preferences} = cfg.loadPreferences(dataDir);
    const run = {
      schemaVersion: config.schemaVersion, runId: `${stamp.day}T${name}`, label, producer: config.producer, scopes,
      createdAt: now.toISOString(), timezone: config.timezone, skillVersion: config.skillVersion, configHash: cfg.configHash(config),
      preferencesSource: path.relative(dataDir, source) || source, preferencesHash: util.sha256(preferences).slice(0, 16),
      node: process.version, platform: process.platform,
    };
    util.writeJson(path.join(runDir, "run.json"), run);
    util.writeJson(path.join(runDir, "budget.json"), {limits: config.budget, used: {}});
    out({runDir, runId: run.runId, scopes, preferences: run.preferencesSource});
  },

  "discovery-script"() {
    process.stdout.write(extractionScript());
  },

  "save-discovery"(args, config) {
    const {runDir} = needRun(args);
    const scope = cfg.scopeList(args.scope, config);
    if (scope.length !== 1) fail("--scope must name one scope");
    if (!args.input) fail("--input FILE is required (JSON returned by the extraction script; an array for several pages)");
    const pages = util.readJson(path.resolve(args.input));
    const discovery = buildDiscovery({scope: scope[0], scopeCfg: config.scopes[scope[0]], config, pages, method: args.method || config.discoveryBrowser.default, savedAt: new Date().toISOString()});
    const budget = cfg.openBudget(runDir, config);
    budget.add(`discoveryPageLoads:${scope[0]}`, discovery.pageLoads);
    util.writeJson(cfg.runPaths(runDir, scope[0]).discovery, discovery);
    out({scope: scope[0], status: discovery.status, reason: discovery.reason, pools: discovery.rowCount, observedAt: discovery.observedAt, possibleTruncation: discovery.possibleTruncation});
    if (discovery.status !== "ok") process.exitCode = 2;
  },

  async collect(args, config) {
    const {runDir, run} = needRun(args);
    const budget = cfg.openBudget(runDir, config);
    const {preferences} = cfg.loadPreferences(dataDirOf(runDir, config));
    const results = [];
    for (const scope of scopesFor(args, run, config)) {
      const scopeCfg = config.scopes[scope];
      const p = cfg.runPaths(runDir, scope);
      const discovery = util.readJson(p.discovery, null);
      if (!discovery || discovery.status !== "ok") {
        const rendered = renderScope({runDir, run, scope, config, stage: "market"});
        results.push({scope, skipped: discovery ? `discovery ${discovery.status}: ${discovery.reason}` : "discovery not saved", markdown: rendered.markdown});
        continue;
      }
      const ageMin = (Date.now() - Date.parse(discovery.observedAt)) / 60000;
      if (ageMin > config.discoveryMaxAgeMinutes) { results.push({scope, skipped: `discovery is ${Math.round(ageMin)} minutes old (limit ${config.discoveryMaxAgeMinutes}); reload the discovery page instead of reusing it`}); continue; }
      const {requests, responses} = await fetchPairs({chain: scopeCfg.chain, slugs: discovery.pools.map(x => x.slug), config, budget});
      util.writeJson(p.raw, {schemaVersion: config.schemaVersion, scope, chain: scopeCfg.chain, requests, responses});
      const observations = aggregate({scope, scopeCfg, config, discovery, requests, responses, excluded: cfg.loadExcludedAssets(scopeCfg), hidden: cfg.hiddenMap(preferences, scopeCfg), runId: run.runId, producer: run.producer});
      observations.compatibilityKey = cfg.compatibilityKey(scope, scopeCfg, config);
      util.writeJson(p.observations, observations);
      const comparison = compareScans({reportsRoot: reportsRootOf(runDir), current: observations, hidden: cfg.hiddenMap(preferences, scopeCfg)});
      util.writeJson(p.comparison, comparison);
      const rendered = renderScope({runDir, run, scope, config, stage: "market"});
      results.push({scope, marketStatus: observations.marketStatus, counts: observations.counts, window: observations.metrics.window, failedRequests: observations.metrics.failedRequests.length, comparison: comparison.prior ? comparison.prior.path : comparison.reason, markdown: rendered.markdown, widget: rendered.widget});
    }
    out({runDir, budgetUsed: budget.state.used, results});
    if (results.some(r => r.skipped || r.marketStatus === "failed")) process.exitCode = 2;
  },

  async evidence(args, config) {
    const {runDir, run} = needRun(args);
    const budget = cfg.openBudget(runDir, config);
    const results = [];
    for (const scope of scopesFor(args, run, config)) {
      const {p, observations, evidence: existing, comparison} = loadScope(runDir, scope);
      if (!observations) { results.push({scope, skipped: "no observations"}); continue; }
      const displayed = observations.rows.filter(r => !r.hidden);
      let onlyIds = null;
      if (args.id) {
        const wanted = String(args.id).split(",").map(x => x.trim()).filter(Boolean);
        const unknown = [];
        onlyIds = [];
        for (const w of wanted) {
          const hit = displayed.filter(r => r.id === w || r.address.toLowerCase() === w.toLowerCase() || r.id.toLowerCase() === w.toLowerCase() || (r.symbol || "").toLowerCase() === w.toLowerCase());
          if (hit.length === 1) onlyIds.push(hit[0].id);
          else if (hit.length > 1) unknown.push(`${w} (ambiguous: ${hit.map(h => h.id).join(", ")})`);
          else if (args.scope) unknown.push(w);
        }
        if (unknown.length) fail(`${scope}: no single displayed row matches ${unknown.join("; ")}`);
        if (!onlyIds.length) { results.push({scope, skipped: "no requested row in this scope"}); continue; }
      }
      const got = await collectEvidence({scope, config, observations, budget, workTextDir: p.workText, onlyIds, existing});
      util.writeJson(p.evidence, got.evidence);
      const measured = measuredMap(observations, got.evidence, comparison, config);
      const rowIds = onlyIds || null;
      const tag = onlyIds ? `-${onlyIds.map(id => (displayed.find(r => r.id === id).symbol || "row").replace(/[^a-z0-9]/gi, "")).join("-").slice(0, 40)}` : "";
      const parts = researchDigest({scope, observations, evidence: got.evidence, measuredByToken: measured, comparison, workTextDir: p.workText, config, rowIds});
      const digestParts = parts.map((text, i) => util.writeText(p.digest.replace(/\.md$/, `${tag}-${i + 1}.md`), text));
      results.push({scope, rowsReadNow: got.newRowIds.length, alreadyRead: got.skippedRowIds.length, counts: got.evidence.counts, chainRead: got.evidence.chainRecord ? {id: got.evidence.chainRecord.id, ok: got.evidence.chainRecord.ok, reason: got.evidence.chainRecord.failureReason || null} : null, digestParts, writeResearchTo: p.research});
    }
    out({runDir, results});
  },

  validate(args, config) {
    const {runDir, run} = needRun(args);
    let failed = false;
    const results = [];
    for (const scope of scopesFor(args, run, config)) {
      const {p, observations, evidence, research, comparison} = loadScope(runDir, scope);
      if (!observations) { results.push({scope, skipped: "no observations"}); continue; }
      if (!research) { results.push({scope, skipped: "no research file (list only)"}); continue; }
      const res = validateResearch({research, observations, evidence: evidence || {reads: []}, measuredByToken: measuredMap(observations, evidence, comparison, config), config, requireAll: !!args.all});
      if (res.errors.length) failed = true;
      results.push({scope, errors: res.errors, warnings: res.warnings, researched: res.researched, notResearched: res.notResearched, statusByToken: res.statusByToken});
    }
    out({runDir, ok: !failed, results});
    if (failed) process.exitCode = 1;
  },

  render(args, config) {
    const {runDir, run} = needRun(args);
    const stage = args.stage === "market" ? "market" : "final";
    out({runDir, results: scopesFor(args, run, config).map(scope => renderScope({runDir, run, scope, config, stage}))});
  },

  finalize(args, config) {
    const {runDir} = needRun(args);
    const coverage = finalizeRun({runDir, config, finishedAt: new Date().toISOString()});
    out({runDir, coverage: cfg.runPaths(runDir, "x").coverage, scopes: Object.fromEntries(Object.entries(coverage.scopes).map(([s, c]) => [s, {discovery: c.discovery.status, market: c.market.status, research: c.research.status}]))});
  },

  aggregate(args, config) {
    const {runDir, run} = needRun(args);
    const scope = cfg.scopeList(args.scope, config)[0];
    const scopeCfg = config.scopes[scope];
    const p = cfg.runPaths(runDir, scope);
    const raw = util.readJson(p.raw);
    const {preferences} = cfg.loadPreferences(dataDirOf(runDir, config));
    const observations = aggregate({scope, scopeCfg, config, discovery: util.readJson(p.discovery), requests: raw.requests, responses: raw.responses, excluded: cfg.loadExcludedAssets(scopeCfg), hidden: cfg.hiddenMap(preferences, scopeCfg), runId: run.runId, producer: run.producer});
    observations.compatibilityKey = cfg.compatibilityKey(scope, scopeCfg, config);
    util.writeJson(p.observations, observations);
    out({scope, counts: observations.counts, marketStatus: observations.marketStatus});
  },
};

async function main() {
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 18) fail("Node 18 or later is required (global fetch).");
  const args = util.parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || command === "help" || !commands[command]) { process.stdout.write(USAGE + "\n"); process.exit(command && command !== "help" ? 1 : 0); }
  const config = cfg.loadConfig(args.config);
  await commands[command](args, config);
}

main().catch(error => fail(error && error.stack ? error.stack : String(error)));
