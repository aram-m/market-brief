"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {REFERENCES} = require("./config.cjs");

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function extractionScript() {
  return fs.readFileSync(path.join(REFERENCES, "discovery-extract.js"), "utf8");
}

function sameUrl(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const params = u => [...u.searchParams.entries()].sort((p, q) => p[0].localeCompare(q[0])).map(([k, v]) => `${k}=${v}`).join("&");
    return x.origin === y.origin && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && params(x) === params(y);
  } catch {
    return false;
  }
}

// The page URL as the browser reported it; when a tool redacts the full URL, rebuild it from origin, path and params.
function pageUrl(page) {
  if (page.url && !/\[BLOCKED/.test(page.url)) return page.url;
  if (page.path && page.params && typeof page.params === "object") {
    const origin = page.origin && !/\[BLOCKED/.test(page.origin) ? page.origin : "https://dexscreener.com";
    return `${origin}${page.path}?${new URLSearchParams(page.params).toString()}`;
  }
  return page.url || null;
}

// Validates one or more page extractions from the browser and returns the discovery record.
// slugsOverride replaces page 1's slugs when the JavaScript tool redacted them (they are read from the accessibility tree instead).
function buildDiscovery({scope, scopeCfg, config, pages, method, savedAt, slugsOverride = null}) {
  const list = (Array.isArray(pages) ? pages : [pages]).map(p => ({...p}));
  if (slugsOverride && list[0]) list[0] = {...list[0], slugs: slugsOverride, slugSource: "accessibility-tree"};
  const pattern = new RegExp(scopeCfg.pairSlugPattern);
  const problems = [];
  const pools = [];
  const seen = new Set();
  const invalid = [];
  let challenge = false;
  for (const [pageIndex, page] of list.entries()) {
    if (!page || typeof page !== "object") { problems.push(`page ${pageIndex + 1}: not an object`); continue; }
    if (page.challenge) challenge = true;
    const slugs = Array.isArray(page.slugs) ? page.slugs : [];
    if (page.checksum && fnv1a(slugs.join("\n")) !== page.checksum) problems.push(`page ${pageIndex + 1}: checksum mismatch (pool list was altered after extraction)`);
    if (!page.checksum) problems.push(`page ${pageIndex + 1}: missing checksum`);
    if (slugs.some(s => /\[BLOCKED/.test(String(s)))) problems.push(`page ${pageIndex + 1}: pool addresses were redacted by the browser tool; read them from the page's accessibility tree and pass --slugs`);
    if (pageIndex === 0 && !sameUrl(pageUrl(page), scopeCfg.discoveryUrl)) problems.push(`page 1 URL differs from the configured discovery URL: ${pageUrl(page)}`);
    if (pageIndex === 0 && page.rankBy && page.rankBy !== scopeCfg.filters.rankBy) problems.push(`page ranks by ${page.rankBy}, expected ${scopeCfg.filters.rankBy}`);
    if (Number.isFinite(page.rowCount) && page.rowCount !== slugs.length) problems.push(`page ${pageIndex + 1}: rowCount ${page.rowCount} != ${slugs.length} slugs`);
    for (const slug of slugs) {
      if (!pattern.test(slug)) { invalid.push(slug); continue; }
      const key = slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pools.push({rank: pools.length + 1, slug, page: pageIndex + 1});
    }
  }
  const first = list[0] || {};
  const observedAt = first.observedAt && !Number.isNaN(Date.parse(first.observedAt)) ? new Date(first.observedAt).toISOString() : null;
  if (!observedAt) problems.push("missing or invalid observedAt");
  let status = "ok";
  let reason = null;
  if (challenge) { status = "blocked"; reason = "Cloudflare or bot challenge shown instead of the discovery table"; }
  else if (problems.length) { status = "invalid"; reason = problems.join("; "); }
  else if (!pools.length) { status = "empty"; reason = "discovery table rendered no pair rows"; }
  const lastPage = list[list.length - 1] || {};
  const possibleTruncation = (lastPage.slugs || []).length >= config.budget.fullPageRows && !!lastPage.nextPage;
  return {
    schemaVersion: config.schemaVersion,
    scope,
    chain: scopeCfg.chain,
    status,
    reason,
    method,
    discoveryUrl: scopeCfg.discoveryUrl,
    pageUrl: pageUrl(first),
    slugSource: first.slugSource || "javascript",
    pageTitle: first.title || null,
    extractor: first.extractor || null,
    filtersIndicator: first.filtersIndicator || null,
    rankBy: first.rankBy || null,
    observedAt,
    savedAt,
    pageLoads: list.length,
    rowCount: pools.length,
    possibleTruncation,
    pools,
    invalidSlugs: invalid,
    problems,
  };
}

// Discovery that could not be attempted (e.g. the chosen browser is not connected): recorded as blocked, no page load.
function unavailableDiscovery({scope, scopeCfg, config, method, reason, savedAt}) {
  return {
    schemaVersion: config.schemaVersion, scope, chain: scopeCfg.chain, status: "blocked", reason: String(reason), method,
    discoveryUrl: scopeCfg.discoveryUrl, pageUrl: null, pageTitle: null, extractor: null, filtersIndicator: null, rankBy: null,
    observedAt: savedAt, savedAt, pageLoads: 0, rowCount: 0, possibleTruncation: false, pools: [], invalidSlugs: [], problems: [],
  };
}

module.exports = {fnv1a, extractionScript, buildDiscovery, unavailableDiscovery, sameUrl};
