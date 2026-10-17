"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "plugins", "market-brief", "skills", "market-brief", "scripts", "lib");
const cfg = require(path.join(LIB, "config.cjs"));
const {aggregate} = require(path.join(LIB, "aggregate.cjs"));
const {buildDiscovery, fnv1a} = require(path.join(LIB, "discovery.cjs"));
const {fetchPairs} = require(path.join(LIB, "metrics.cjs"));
const {validateResearch, overviewStatus} = require(path.join(LIB, "research.cjs"));
const {measuredFacts} = require(path.join(LIB, "measured.cjs"));
const {buildBrief, renderMarkdown, renderWidget} = require(path.join(LIB, "render.cjs"));
const {extractPage} = require(path.join(LIB, "html-extract.cjs"));
const {collectEvidence} = require(path.join(LIB, "evidence.cjs"));

const FIX = path.join(__dirname, "fixtures", "2026-10-16");
const config = cfg.loadConfig();
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8"));
const routes = JSON.parse(fs.readFileSync(path.join(FIX, "discovery-routes.json"), "utf8"));
const RAW = {sol: "solana-responses.json", rh: "robinhood-responses.json"};
const CHAIN = {sol: "solana", rh: "robinhood"};

// Saved display exclusions confirmed on 16 Oct 2026: 10 Solana tokens plus BABA and CRCL.
const PREFS = {hidden: [
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy", "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS", "3ZLekZYq2qkZiSpnSvabjit34tUkjSwD1JFuW9as9wBG",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL", "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
].map(a => ({id: `solana:${a}`})).concat([
  {id: "robinhood:0xad25ac6c84d497db898fa1e8387bf6af3532a1c4"}, {id: "robinhood:0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5"},
])};

function fixture(scope, mutate) {
  const scopeCfg = config.scopes[scope];
  const slugs = routes[CHAIN[scope]];
  const discovery = buildDiscovery({scope, scopeCfg, config, method: "fixture", savedAt: routes.observedAt,
    pages: [{url: scopeCfg.discoveryUrl, observedAt: routes.observedAt, rowCount: slugs.length, slugs, checksum: fnv1a(slugs.join("\n"))}]});
  const saved = JSON.parse(fs.readFileSync(path.join(FIX, RAW[scope]), "utf8"));
  const requests = saved.map(b => ({ok: b.status === "fulfilled", url: b.value.url, receivedAt: b.value.observedAt, addresses: b.value.url.split("/").pop().split(",")}));
  const responses = saved.map(b => ({url: b.value.url, receivedAt: b.value.observedAt, pairs: JSON.parse(JSON.stringify(b.value.data.pairs))}));
  if (mutate) mutate(responses);
  const obs = aggregate({scope, scopeCfg, config, discovery, requests, responses, excluded: cfg.loadExcludedAssets(scopeCfg), hidden: cfg.hiddenMap(PREFS, scopeCfg), runId: "test-run", producer: "claude-test"});
  return {discovery, obs, scopeCfg};
}

test("discovery fixture validates and keeps rank order", () => {
  const {discovery} = fixture("sol");
  assert.equal(discovery.status, "ok");
  assert.equal(discovery.rowCount, 59);
  assert.equal(discovery.pools[0].rank, 1);
});

test("discovery rejects altered lists, challenges and other URLs", () => {
  const scopeCfg = config.scopes.sol;
  const base = {url: scopeCfg.discoveryUrl, observedAt: "2026-10-16T06:57:28.450Z", slugs: ["da4pm4xsdy4m9v4cgakkbvh1pw1ysctqqa5nekghukpt"], rowCount: 1};
  const ok = buildDiscovery({scope: "sol", scopeCfg, config, method: "t", savedAt: "x", pages: {...base, checksum: fnv1a(base.slugs[0])}});
  assert.equal(ok.status, "ok");
  assert.equal(buildDiscovery({scope: "sol", scopeCfg, config, method: "t", savedAt: "x", pages: {...base, checksum: "00000000"}}).status, "invalid");
  assert.equal(buildDiscovery({scope: "sol", scopeCfg, config, method: "t", savedAt: "x", pages: {...base, checksum: fnv1a(base.slugs[0]), challenge: true}}).status, "blocked");
  assert.equal(buildDiscovery({scope: "sol", scopeCfg, config, method: "t", savedAt: "x", pages: {...base, url: "https://dexscreener.com/solana", checksum: fnv1a(base.slugs[0])}}).status, "invalid");
  assert.equal(buildDiscovery({scope: "sol", scopeCfg, config, method: "t", savedAt: "x", pages: {...base, rankBy: "trendingScoreM5", checksum: fnv1a(base.slugs[0])}}).status, "invalid");
});

for (const scope of ["sol", "rh"]) {
  test(`${scope}: totals match the independently recomputed 16 Oct run`, () => {
    const {obs} = fixture(scope);
    const exp = expected[scope];
    assert.equal(obs.counts.discoveredPools, exp.discoveredPools);
    assert.equal(obs.counts.resolvedPools, exp.resolvedPools);
    assert.equal(obs.counts.excludedPools, exp.excludedPools);
    assert.equal(obs.counts.tokens, exp.tokens);
    assert.equal(obs.counts.unresolvedPools, 0);
    for (const row of obs.rows) {
      assert.ok(Math.abs(row.volume24h.value - exp.volume24h[row.id]) < 0.01, `${row.id} volume`);
      assert.ok(Math.abs(row.liquidity.value - exp.liquidity[row.id]) < 0.01, `${row.id} liquidity`);
      assert.equal(row.pools.length, exp.pools[row.id], `${row.id} pools`);
    }
  });
}

test("display exclusions hide exactly the saved IDs and keep raw rows", () => {
  const sol = fixture("sol").obs;
  const rh = fixture("rh").obs;
  assert.equal(sol.counts.displayedTokens, 19);
  assert.equal(sol.counts.hiddenTokens, 8);
  assert.equal(rh.counts.displayedTokens, 7);
  assert.equal(sol.rows.length, 27);
  assert.ok(rh.rows.find(r => r.symbol === "CRCL").hidden);
});

test("rows sort by 24h volume descending with unavailable volume last", () => {
  const {obs} = fixture("sol", responses => { for (const r of responses) for (const p of r.pairs) if (p.baseToken.symbol === "ORE") delete p.volume; });
  const values = obs.rows.map(r => r.volume24h.value);
  const ore = obs.rows.findIndex(r => r.symbol === "ORE");
  assert.equal(ore, obs.rows.length - 1);
  for (let i = 1; i < values.length - 1; i++) assert.ok(values[i - 1] >= values[i]);
});

test("a pool missing volume yields a labelled partial sum, not a blank total", () => {
  let dropped = 0;
  const {obs} = fixture("sol", responses => { for (const r of responses) for (const p of r.pairs) if (p.baseToken.symbol === "ORE" && !dropped) { dropped = p.volume.h24; delete p.volume; } });
  const ore = obs.rows.find(r => r.symbol === "ORE");
  assert.equal(ore.volume24h.partial, true);
  assert.equal(ore.volume24h.poolsWithValue, 3);
  assert.ok(Math.abs(ore.volume24h.value - (expected.sol.volume24h[ore.id] - dropped)) < 0.01);
  assert.ok(ore.flags.some(f => f.code === "volumePartial"));
});

test("missing pool creation time is null and flagged, never 'now'", () => {
  const {obs} = fixture("sol", responses => { for (const r of responses) for (const p of r.pairs) if (p.baseToken.symbol === "ORE") delete p.pairCreatedAt; });
  const ore = obs.rows.find(r => r.symbol === "ORE");
  assert.equal(ore.oldestPoolAt, null);
  assert.ok(ore.flags.some(f => f.code === "poolCreationUnavailable"));
});

test("pools are credited to the base token; the quote side records alsoQuotedIn", () => {
  const {obs} = fixture("sol");
  const stonk = obs.rows.find(r => r.symbol === "STONK");
  const ore = obs.rows.find(r => r.symbol === "ORE");
  assert.ok(stonk.alsoQuotedIn.some(ref => ref.baseSymbol === "ORE"));
  assert.ok(!stonk.pools.some(p => ore.pools.some(q => q.pairAddress === p.pairAddress)));
});

test("stable/wrapped exclusion is by base contract; quote-side pools are kept", () => {
  const {obs} = fixture("sol");
  for (const ex of obs.excludedPools) assert.ok(["WSOL", "SOL", "USDC"].includes(ex.base.symbol) || /USD/.test(ex.base.symbol), ex.base.symbol);
  assert.ok(obs.rows.some(r => r.pools.some(p => p.quote.symbol === "SOL")));
});

test("valuation flags: market cap above FDV is surfaced as a measured fact", () => {
  const {obs} = fixture("sol");
  const ore = obs.rows.find(r => r.symbol === "ORE");
  assert.ok(ore.flags.some(f => f.code === "mcapExceedsFdv"));
  const facts = measuredFacts(ore, {metricsAt: obs.metrics.window.to});
  assert.ok(facts.some(f => f.key === "measured:valuation"));
  assert.ok(facts.find(f => f.key === "measured:poolAge").text.includes("not a launch date"));
});

test("pair fetch retries retryable errors, records reasons and respects the call budget", async () => {
  const calls = [];
  const fakeFetch = async url => {
    calls.push(url);
    if (calls.length === 1) return {ok: false, status: 429, headers: new Map([["cf-ray", "x"]])};
    return {ok: true, status: 200, headers: new Map(), json: async () => ({pairs: [{pairAddress: "A"}]})};
  };
  const ledger = {used: 0, take() { if (this.used >= 3) return false; this.used++; return true; }};
  const {requests, responses} = await fetchPairs({chain: "solana", slugs: Array.from({length: 61}, (_, i) => `a${i}`), config, budget: ledger, fetchImpl: fakeFetch, sleepImpl: async () => {}});
  assert.equal(requests[0].error, "HTTP 429");
  assert.equal(requests[0].ok, false);
  assert.equal(requests[1].ok, true);
  assert.equal(responses.length, 2);
  assert.match(requests[requests.length - 1].error, /budget exhausted/);
  assert.equal(calls.length, 3);
});

function researchFixture() {
  const {obs} = fixture("rh");
  const displayed = obs.rows.filter(r => !r.hidden);
  const measuredByToken = Object.fromEntries(displayed.map(r => [r.id, measuredFacts(r, {metricsAt: obs.metrics.window.to})]));
  const evidence = {reads: [{id: "rh-E1", tokenId: displayed[0].id, kind: "website", url: "https://example.com", ok: true, readable: true}, {id: "rh-E2", tokenId: displayed[0].id, kind: "website", url: "https://example.com/app", ok: true, readable: false, failureReason: "no readable text"}], chainRecord: {id: "rh-REG", ok: true}};
  const research = {scope: "rh", runId: obs.runId, researchCompletedAt: "2026-10-16T07:05:00.000Z", webReads: [], projects: displayed.map(r => ({
    id: r.id,
    claims: r === displayed[0] ? [{field: "purpose", kind: "project_claim", status: "claimed_unverified", text: "Says it is a meme token.", evidence: ["rh-E1"]}, {field: "mechanics", kind: "project_claim", status: "claimed_unverified", text: "Says trading fees fund buybacks.", evidence: ["rh-E1"]}] : [],
    aiView: {text: "Volume is high relative to liquidity.", basedOn: ["measured:pools"]},
    launch: {label: null},
    gaps: r === displayed[0] ? [] : [{what: "purpose", reason: "no website listed"}],
  }))};
  return {obs, evidence, research, measuredByToken};
}

test("valid research passes and overview status is computed, not asserted", () => {
  const {obs, evidence, research, measuredByToken} = researchFixture();
  const res = validateResearch({research, observations: obs, evidence, measuredByToken, config});
  assert.deepEqual(res.errors, []);
  assert.equal(overviewStatus(research.projects[0]), "complete");
  assert.equal(overviewStatus(research.projects[1]), "incomplete");
});

test("research validation rejects unreadable evidence, verified claims, pool-age launches and missing rows", () => {
  const {obs, evidence, research, measuredByToken} = researchFixture();
  research.projects[0].claims[0].evidence = ["rh-E2"];
  research.projects[0].claims[1].status = "verified";
  research.projects[0].launch = {label: "verified launch 2026-10-12", evidence: ["measured:poolAge"]};
  research.projects.pop();
  const res = validateResearch({research, observations: obs, evidence, measuredByToken, config}).errors.join("\n");
  assert.match(res, /no readable content/);
  assert.match(res, /verified needs a measured fact/);
  assert.match(res, /pool creation does not prove a launch/);
  assert.doesNotMatch(res, /has no research entry/);
  assert.match(validateResearch({research, observations: obs, evidence, measuredByToken, config, requireAll: true}).errors.join("\n"), /has no research entry/);
});

test("research on request: a single researched row validates and the rest are not researched", () => {
  const {obs, evidence, research, measuredByToken} = researchFixture();
  research.projects = research.projects.slice(0, 1);
  const res = validateResearch({research, observations: obs, evidence, measuredByToken, config});
  assert.deepEqual(res.errors, []);
  assert.equal(res.researched, 1);
  assert.equal(res.notResearched, obs.rows.filter(r => !r.hidden).length - 1);
  const brief = buildBrief({scope: "rh", scopeCfg: config.scopes.rh, config, run: {runId: obs.runId, producer: "claude-test"}, observations: obs, evidence, research, comparison: null, measuredByToken});
  const md = renderMarkdown(brief);
  assert.match(md, /\| AI comment \|/);
  assert.match(md, /not researched/);
  assert.equal((md.match(/^- \*\*/gm) || []).length, 1);
  assert.equal(brief.rows.filter(r => r.note.status === "not researched").length, brief.rows.length - 1);
});

test("markdown paginates at 12 rows and the widget is a fragment", () => {
  const {obs} = fixture("sol");
  const displayed = obs.rows.filter(r => !r.hidden);
  const measuredByToken = Object.fromEntries(displayed.map(r => [r.id, measuredFacts(r, {metricsAt: obs.metrics.window.to})]));
  const brief = buildBrief({scope: "sol", scopeCfg: config.scopes.sol, config, run: {runId: "test-run", producer: "claude-test"}, observations: obs, evidence: null, research: null, comparison: null, measuredByToken});
  const md = renderMarkdown(brief);
  assert.match(md, /Page 2 of 2/);
  assert.doesNotMatch(md, /AI comment|Research pending|\*\*Notes\*\*/);
  assert.match(md, /research <symbol>/);
  assert.equal(brief.stage, "list");
  const widget = renderWidget(brief);
  assert.ok(!/<!doctype|<html|<body/i.test(widget));
  assert.ok(widget.includes("sendPrompt"));
});

test("HTML extraction keeps meta and og descriptions from JavaScript-only pages", () => {
  const page = extractPage(`<html><head><title>ORE</title><meta property="og:description" content="Future-proof store of value."><meta content="Mine &amp; stake" name="description"></head><body><div id="root"></div><script>var x=1</script></body></html>`);
  assert.equal(page.title, "ORE");
  assert.equal(page.ogDescription, "Future-proof store of value.");
  assert.equal(page.metaDescription, "Mine & stake");
  assert.equal(page.text, "");
});

test("each chain's filters match its discovery URL; Robinhood uses the $250K volume floor", () => {
  for (const [scope, sc] of Object.entries(config.scopes)) {
    const q = new URL(sc.discoveryUrl).searchParams;
    assert.equal(q.get("rankBy"), sc.filters.rankBy, scope);
    assert.equal(Number(q.get("minMarketCap")), sc.filters.minMarketCapUsd, scope);
    assert.equal(Number(q.get("minAge")), sc.filters.minPoolAgeHours, scope);
    assert.equal(Number(q.get("min24HVol")), sc.filters.minPool24hVolumeUsd, scope);
    assert.equal(q.get("profile") === "1", sc.filters.profileRequired, scope);
  }
  assert.equal(config.scopes.rh.filters.minPool24hVolumeUsd, 250000);
  assert.equal(config.scopes.sol.filters.minPool24hVolumeUsd, 1000000);
});

test("evidence for one row merges into earlier reads and skips rows already read", async () => {
  const {obs} = fixture("rh");
  const displayed = obs.rows.filter(r => !r.hidden);
  const html = `<html><head><title>T</title><meta name="description" content="A project page"></head><body>${"word ".repeat(60)}</body></html>`;
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (url.includes("rhj/assets")) return {ok: true, status: 200, headers: new Map(), json: async () => ({assets: []})};
    return {ok: true, status: 200, url, headers: new Map([["content-type", "text/html"]]), body: null, text: async () => html};
  };
  const used = {};
  const budget = {take(key, limit) { const max = limit !== undefined ? limit : config.budget[key]; if ((used[key] || 0) >= max) return false; used[key] = (used[key] || 0) + 1; return true; }};
  const workTextDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "mb-test-"));
  const first = await collectEvidence({scope: "rh", config, observations: obs, budget, fetchImpl: fakeFetch, workTextDir, onlyIds: [displayed[0].id]});
  assert.deepEqual(Object.keys(first.evidence.byToken), [displayed[0].id]);
  assert.equal(first.evidence.chainRecord.id, "rh-REG");
  const registryCalls = calls.filter(u => u.includes("rhj/assets")).length;
  const second = await collectEvidence({scope: "rh", config, observations: obs, budget, fetchImpl: fakeFetch, workTextDir, onlyIds: [displayed[0].id, displayed[1].id], existing: first.evidence});
  assert.deepEqual(second.newRowIds, [displayed[1].id]);
  assert.deepEqual(second.skippedRowIds, [displayed[0].id]);
  assert.equal(calls.filter(u => u.includes("rhj/assets")).length, registryCalls);
  const ids = second.evidence.reads.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(second.evidence.reads.filter(r => r.tokenId === displayed[0].id).length >= 1);
  fs.rmSync(workTextDir, {recursive: true, force: true});
});

test("CLI: new-run creates work/, unavailable and blocked scopes exit 0, an invalid list exits 3", () => {
  const {spawnSync} = require("node:child_process");
  const os = require("node:os");
  const MB = path.join(LIB, "..", "mb.cjs");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "mb-cli-"));
  const run = (...args) => spawnSync(process.execPath, [MB, ...args], {encoding: "utf8"});
  const created = run("new-run", "--data", data, "--scopes", "sol,rh");
  assert.equal(created.status, 0, created.stderr);
  const {runDir} = JSON.parse(created.stdout);
  assert.ok(fs.statSync(path.join(runDir, "work")).isDirectory());
  const unavailable = run("save-discovery", "--run", runDir, "--scope", "sol", "--unavailable", "Claude in Chrome not connected");
  assert.equal(unavailable.status, 0, unavailable.stderr);
  assert.equal(JSON.parse(unavailable.stdout).status, "blocked");
  const page = path.join(runDir, "work", "discovery-page-rh.json");
  fs.writeFileSync(page, JSON.stringify({url: config.scopes.rh.discoveryUrl, observedAt: new Date().toISOString(), rankBy: "trendingScoreH6", rowCount: 1, slugs: ["0x590dcb6a87828bf688b48089a62239b693378f1fb64d2286e6a399ed8c005fdf"], checksum: "00000000"}));
  const invalid = run("save-discovery", "--run", runDir, "--scope", "rh", "--input", page);
  assert.equal(invalid.status, 3);
  assert.match(JSON.parse(invalid.stdout).next, /Re-run the extraction script/);
  const collected = run("collect", "--run", runDir);
  assert.equal(collected.status, 0, collected.stderr);
  assert.ok(JSON.parse(collected.stdout).results.every(r => r.skipped));
  assert.match(fs.readFileSync(path.join(runDir, "brief-sol.md"), "utf8"), /no current market data \(discovery blocked: Claude in Chrome not connected\)/);
  fs.rmSync(data, {recursive: true, force: true});
});

test("Chrome hybrid discovery: redacted URL is rebuilt from path and params; accessibility-tree slugs must match the page checksum", () => {
  const scopeCfg = config.scopes.rh;
  const slugs = ["0x338fce553e60c8b0acccde1956bc378586ef6f2935339ebae5804d429d461e44", "0x10cc6bd38112cac182db90b6a71d8bb5939526ba"];
  const q = Object.fromEntries(new URL(scopeCfg.discoveryUrl).searchParams);
  const page = {url: "[BLOCKED: Cookie/query string data]", origin: "https://dexscreener.com", path: "/robinhood", params: q, rankBy: q.rankBy, observedAt: "2026-10-17T08:46:10.532Z", rowCount: 2, slugs: ["[BLOCKED: Base64 encoded data]", "[BLOCKED: Base64 encoded data]"], checksum: fnv1a(slugs.join("\n"))};
  const blocked = buildDiscovery({scope: "rh", scopeCfg, config, method: "claude-in-chrome", savedAt: "x", pages: page});
  assert.equal(blocked.status, "invalid");
  assert.match(blocked.reason, /redacted/);
  const ok = buildDiscovery({scope: "rh", scopeCfg, config, method: "claude-in-chrome", savedAt: "x", pages: page, slugsOverride: slugs});
  assert.equal(ok.status, "ok", ok.reason);
  assert.equal(ok.slugSource, "accessibility-tree");
  assert.equal(ok.pageUrl.includes("min24HVol=250000"), true);
  const wrongOrder = buildDiscovery({scope: "rh", scopeCfg, config, method: "claude-in-chrome", savedAt: "x", pages: page, slugsOverride: [...slugs].reverse()});
  assert.equal(wrongOrder.status, "invalid");
  assert.match(wrongOrder.reason, /checksum mismatch/);
});
