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
  assert.match(res, /has no research entry/);
});

test("markdown paginates at 12 rows and the widget is a fragment", () => {
  const {obs} = fixture("sol");
  const displayed = obs.rows.filter(r => !r.hidden);
  const measuredByToken = Object.fromEntries(displayed.map(r => [r.id, measuredFacts(r, {metricsAt: obs.metrics.window.to})]));
  const brief = buildBrief({scope: "sol", scopeCfg: config.scopes.sol, config, run: {runId: "test-run", producer: "claude-test"}, observations: obs, evidence: null, research: null, comparison: null, measuredByToken, stage: "market"});
  const md = renderMarkdown(brief);
  assert.match(md, /Page 2 of 2/);
  assert.equal((md.match(/Research pending/g) || []).length, 19);
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
