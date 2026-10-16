"use strict";
const fs = require("node:fs");
const {readJson, formatLocalTime, formatLocalDate} = require("./util.cjs");
const {runPaths} = require("./config.cjs");
const {overviewStatus} = require("./research.cjs");

function scopeCoverage(runDir, scope) {
  const p = runPaths(runDir, scope);
  const discovery = readJson(p.discovery, null);
  const obs = readJson(p.observations, null);
  const evidence = readJson(p.evidence, null);
  const research = readJson(p.research, null);
  const comparison = readJson(p.comparison, null);
  const displayed = obs ? obs.rows.filter(r => !r.hidden) : [];
  const projects = new Map((research && research.projects || []).map(x => [x.id, x]));
  const statuses = displayed.map(r => projects.has(r.id) ? overviewStatus(projects.get(r.id)) : "missing");
  const count = s => statuses.filter(x => x === s).length;
  let researchStatus = "not run";
  if (research) researchStatus = statuses.every(s => s === "complete") ? "complete" : statuses.some(s => s === "complete" || s === "partial") ? "partial" : "incomplete";
  return {
    discovery: discovery ? {status: discovery.status, reason: discovery.reason, observedAt: discovery.observedAt, rows: discovery.rowCount, method: discovery.method, url: discovery.discoveryUrl, possibleTruncation: discovery.possibleTruncation} : {status: "missing"},
    market: obs ? {status: obs.marketStatus, window: obs.metrics.window, counts: obs.counts, unresolvedPools: obs.unresolvedPools, failedRequests: obs.metrics.failedRequests, excludedPools: obs.excludedPools.length, hidden: obs.rows.filter(r => r.hidden).map(r => ({id: r.id, symbol: r.symbol}))} : {status: "not run"},
    evidence: evidence ? {counts: evidence.counts, chainRead: evidence.chainRecord ? {id: evidence.chainRecord.id, ok: evidence.chainRecord.ok, failureReason: evidence.chainRecord.failureReason || null} : null, failedReads: evidence.reads.filter(r => !r.ok || !r.readable).map(r => ({id: r.id, tokenId: r.tokenId, url: r.finalUrl || r.url, requestedUrl: r.url, reason: r.failureReason || "unreadable"}))} : null,
    research: {status: researchStatus, completedAt: research ? research.researchCompletedAt || null : null, counts: {displayed: displayed.length, complete: count("complete"), partial: count("partial"), incomplete: count("incomplete"), missing: count("missing")}, gaps: displayed.filter(r => projects.has(r.id)).map(r => ({id: r.id, symbol: r.symbol, status: overviewStatus(projects.get(r.id)), gaps: projects.get(r.id).gaps || []})).filter(x => x.status !== "complete"), webReads: research ? (research.webReads || []).length : 0},
    comparison: comparison ? {prior: comparison.prior, reason: comparison.reason || null, newlySurfaced: comparison.newlySurfaced.length, noLongerQualifying: comparison.noLongerQualifying.length} : null,
  };
}

function finalizeRun({runDir, config, finishedAt}) {
  const p = runPaths(runDir, "x");
  const run = readJson(p.run);
  const budget = readJson(p.budget, {limits: config.budget, used: {}});
  const scopes = {};
  for (const scope of run.scopes) {
    scopes[scope] = scopeCoverage(runDir, scope);
    const research = readJson(runPaths(runDir, scope).research, null);
    const web = research ? research.webReads || [] : [];
    budget.used[`webSearches:${scope}`] = web.filter(w => w.method === "websearch").length;
    budget.used[`webFetches:${scope}`] = web.filter(w => w.method === "webfetch").length;
  }
  fs.writeFileSync(p.budget, JSON.stringify(budget, null, 2) + "\n");
  const coverage = {schemaVersion: config.schemaVersion, runId: run.runId, producer: run.producer, finishedAt, scopes, budget};
  const tz = config.timezone;
  const lines = [`# Market brief run ${run.runId}`, "", `Producer: ${run.producer}. Created ${formatLocalDate(run.createdAt, tz)} ${formatLocalTime(run.createdAt, tz)} ${tz}. Scopes: ${run.scopes.join(", ")}.`, ""];
  for (const [scope, c] of Object.entries(scopes)) {
    lines.push(`## ${config.scopes[scope].label}`);
    lines.push(`- Discovery: ${c.discovery.status}${c.discovery.reason ? ` (${c.discovery.reason})` : ""}, ${c.discovery.rows || 0} pools at ${c.discovery.observedAt || "n/a"} via ${c.discovery.method || "n/a"}.`);
    if (c.market.counts) lines.push(`- Market: ${c.market.status}; ${c.market.counts.resolvedPools}/${c.market.counts.discoveredPools} pools resolved, ${c.market.counts.excludedPools} stable/wrapped-base pools excluded, ${c.market.counts.tokens} tokens, ${c.market.counts.hiddenTokens} hidden by preference, ${c.market.counts.displayedTokens} displayed. Window ${c.market.window.from} to ${c.market.window.to}.`);
    else lines.push(`- Market: ${c.market.status}.`);
    if (c.evidence) lines.push(`- Evidence: ${c.evidence.counts.reads} reads, ${c.evidence.counts.readable} readable, ${c.evidence.counts.failed} failed; ${c.evidence.counts.rowsWithoutWebsite} rows list no website.`);
    lines.push(`- Research: ${c.research.status}; ${c.research.counts.complete} complete, ${c.research.counts.partial} partial, ${c.research.counts.incomplete} incomplete${c.research.counts.missing ? `, ${c.research.counts.missing} missing` : ""}.`);
    if (c.comparison) lines.push(`- Comparison: ${c.comparison.prior ? `vs ${c.comparison.prior.path}; ${c.comparison.newlySurfaced} newly surfaced, ${c.comparison.noLongerQualifying} no longer qualifying` : c.comparison.reason}.`);
    lines.push("");
  }
  lines.push("Measured facts come from the Dexscreener pair API and chain reads; project statements are the projects' own claims; AI views are interpretation. Pool creation is not a launch date. No trades were placed.", "", `_${config.brief.disclaimer}_`, "");
  fs.writeFileSync(p.coverage, JSON.stringify(coverage, null, 2) + "\n");
  fs.writeFileSync(p.readme, lines.join("\n"));
  run.finishedAt = finishedAt;
  fs.writeFileSync(p.run, JSON.stringify(run, null, 2) + "\n");
  return coverage;
}

module.exports = {finalizeRun, scopeCoverage};
