"use strict";
const {finite, toNumber, round, tokenId} = require("./util.cjs");

const STABLE_HINT = /^(usd|usdc|usdt|usde|usds|dai|fdusd|tusd|pyusd|usdg|usd1|usdv|eurc)$|stable|tether|usd coin/i;
const HOUR = 3600 * 1000;

function sumField(pools, get) {
  const values = pools.map(get).filter(finite);
  return {
    value: values.length ? round(values.reduce((s, v) => s + v, 0), 2) : null,
    poolsWithValue: values.length,
    poolsTotal: pools.length,
    partial: values.length > 0 && values.length < pools.length,
  };
}

function compareRows(a, b) {
  const va = finite(a.volume24h.value) ? a.volume24h.value : -Infinity;
  const vb = finite(b.volume24h.value) ? b.volume24h.value : -Infinity;
  if (va !== vb) return va > vb ? -1 : 1;
  return (a.discoveryRank || Infinity) - (b.discoveryRank || Infinity);
}

function poolSummary(p, slug) {
  return {
    pairAddress: p.pairAddress,
    discoverySlug: slug || null,
    dexId: p.dexId || null,
    url: p.url || null,
    labels: p.labels || [],
    quote: {address: p.quoteToken && p.quoteToken.address, symbol: p.quoteToken && p.quoteToken.symbol, name: p.quoteToken && p.quoteToken.name},
    volume24h: toNumber(p.volume && p.volume.h24),
    liquidityUsd: toNumber(p.liquidity && p.liquidity.usd),
    priceUsd: toNumber(p.priceUsd),
    change24h: toNumber(p.priceChange && p.priceChange.h24),
    marketCap: toNumber(p.marketCap),
    fdv: toNumber(p.fdv),
    pairCreatedAt: finite(p.pairCreatedAt) ? new Date(p.pairCreatedAt).toISOString() : null,
  };
}

function filterRecheck(pool, filters, metricsAt) {
  const failed = [];
  const valuation = finite(pool.marketCap) ? pool.marketCap : pool.fdv;
  if (!finite(valuation) || valuation < filters.minMarketCapUsd) failed.push("minMarketCap");
  if (!pool.pairCreatedAt || (Date.parse(metricsAt) - Date.parse(pool.pairCreatedAt)) / HOUR < filters.minPoolAgeHours) failed.push("minPoolAge");
  if (!finite(pool.volume24h) || pool.volume24h < filters.minPool24hVolumeUsd) failed.push("min24hVolume");
  return failed;
}

// Aggregates distinct discovered pools by exact token identity, following the reporting agreement.
function aggregate({scope, scopeCfg, config, discovery, requests, responses, excluded, hidden, runId, producer}) {
  const chain = scopeCfg.chain;
  const cs = scopeCfg.caseSensitive;
  const idOf = address => tokenId(chain, address, cs);
  const slugByKey = new Map(discovery.pools.map(p => [p.slug.toLowerCase(), p]));
  const failedByKey = new Map();
  for (const r of requests) if (!r.ok) for (const a of r.addresses || []) failedByKey.set(a.toLowerCase(), r.error);
  for (const r of requests) if (r.ok) for (const a of r.addresses || []) failedByKey.delete(a.toLowerCase());

  const byPair = new Map();
  const unexpected = [];
  for (const res of responses) {
    for (const p of res.pairs || []) {
      if (!p || !p.pairAddress || !p.baseToken) continue;
      const key = p.pairAddress.toLowerCase();
      if (p.chainId && p.chainId !== chain) { unexpected.push({pairAddress: p.pairAddress, reason: `returned for chain ${p.chainId}`}); continue; }
      if (!slugByKey.has(key)) { unexpected.push({pairAddress: p.pairAddress, reason: "returned but not in discovery"}); continue; }
      if (!byPair.has(key)) byPair.set(key, p);
    }
  }
  const unresolved = discovery.pools
    .filter(p => !byPair.has(p.slug.toLowerCase()))
    .map(p => ({slug: p.slug, rank: p.rank, reason: failedByKey.has(p.slug.toLowerCase()) ? `request failed: ${failedByKey.get(p.slug.toLowerCase())}` : "not returned by the pair API"}));

  const okTimes = requests.filter(r => r.ok && r.receivedAt).map(r => r.receivedAt).sort();
  const metricsAt = okTimes.length ? okTimes[okTimes.length - 1] : null;

  const groups = new Map();
  const excludedPools = [];
  const quotedIn = new Map();
  for (const [key, p] of byPair) {
    const baseId = idOf(p.baseToken.address);
    const quoteId = p.quoteToken && p.quoteToken.address ? idOf(p.quoteToken.address) : null;
    const asset = excluded.get(baseId);
    const ref = {pairAddress: p.pairAddress, baseId, baseSymbol: p.baseToken.symbol, volume24h: toNumber(p.volume && p.volume.h24), liquidityUsd: toNumber(p.liquidity && p.liquidity.usd), baseExcluded: !!asset};
    if (quoteId && !excluded.has(quoteId)) {
      if (!quotedIn.has(quoteId)) quotedIn.set(quoteId, []);
      quotedIn.get(quoteId).push(ref);
    }
    if (asset) {
      excludedPools.push({pairAddress: p.pairAddress, base: {id: baseId, symbol: p.baseToken.symbol}, quote: {id: quoteId, symbol: p.quoteToken && p.quoteToken.symbol}, reason: `base is ${asset.symbol} (${asset.category}), excluded by contract`});
      continue;
    }
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId).push({raw: p, summary: poolSummary(p, slugByKey.get(key).slug), rank: slugByKey.get(key).rank});
  }

  const rows = [];
  for (const [id, items] of groups) {
    items.sort((a, b) => (finite(b.summary.liquidityUsd) ? b.summary.liquidityUsd : -1) - (finite(a.summary.liquidityUsd) ? a.summary.liquidityUsd : -1));
    const pools = items.map(i => i.summary);
    const lead = items[0].raw;
    const v = pools[0];
    const withInfo = items.find(i => i.raw.info) || items[0];
    const created = pools.map(p => p.pairCreatedAt).filter(Boolean).sort();
    const changes = pools.map(p => p.change24h).filter(finite);
    const fdvs = pools.map(p => p.fdv).filter(finite);
    const flags = [];
    if (finite(v.marketCap) && finite(v.fdv) && v.marketCap > v.fdv * 1.01) flags.push({code: "mcapExceedsFdv", ratio: round(v.marketCap / v.fdv, 2)});
    if (fdvs.length > 1 && Math.max(...fdvs) / Math.min(...fdvs) > 1.1) flags.push({code: "fdvSpread", min: Math.min(...fdvs), max: Math.max(...fdvs)});
    if (changes.length > 1 && Math.max(...changes) - Math.min(...changes) >= 10) flags.push({code: "changeSpread", min: Math.min(...changes), max: Math.max(...changes)});
    const volume24h = sumField(pools, p => p.volume24h);
    const liquidity = sumField(pools, p => p.liquidityUsd);
    if (volume24h.partial) flags.push({code: "volumePartial", pools: `${volume24h.poolsWithValue}/${volume24h.poolsTotal}`});
    if (liquidity.partial) flags.push({code: "liquidityPartial", pools: `${liquidity.poolsWithValue}/${liquidity.poolsTotal}`});
    if (!created.length) flags.push({code: "poolCreationUnavailable"});
    if (STABLE_HINT.test(lead.baseToken.symbol || "") || STABLE_HINT.test(lead.baseToken.name || "")) flags.push({code: "suspectedStableNotExcluded"});
    const hiddenEntry = hidden.get(id);
    rows.push({
      id,
      chain,
      address: lead.baseToken.address,
      name: lead.baseToken.name,
      symbol: lead.baseToken.symbol,
      url: v.url,
      discoveryRank: Math.min(...items.map(i => i.rank)),
      volume24h,
      liquidity,
      price: v.priceUsd,
      change24h: v.change24h,
      change24hRange: changes.length > 1 ? [Math.min(...changes), Math.max(...changes)] : null,
      marketCap: v.marketCap,
      fdv: v.fdv,
      valuation: {
        metric: finite(v.marketCap) ? "marketCap" : finite(v.fdv) ? "fdv" : null,
        value: finite(v.marketCap) ? v.marketCap : finite(v.fdv) ? v.fdv : null,
        source: {pairAddress: v.pairAddress, dexId: v.dexId, quoteSymbol: v.quote.symbol, rule: "most liquid returned pool"},
      },
      oldestPoolAt: created.length ? created[0] : null,
      oldestPoolAtLabel: "pool creation time (not a project launch date)",
      flags,
      pools,
      alsoQuotedIn: (quotedIn.get(id) || []).filter(ref => ref.baseId !== id),
      info: {websites: (withInfo.raw.info && withInfo.raw.info.websites) || [], socials: (withInfo.raw.info && withInfo.raw.info.socials) || []},
      hidden: !!hiddenEntry,
      hiddenReason: hiddenEntry ? (hiddenEntry.reason || "saved display preference") : null,
    });
  }
  rows.sort(compareRows);
  const recheck = [];
  if (metricsAt) for (const row of rows) for (const pool of row.pools) {
    const failed = filterRecheck(pool, config.filters, metricsAt);
    if (failed.length) recheck.push({tokenId: row.id, pairAddress: pool.pairAddress, failed});
  }
  const failedRequests = requests.filter(r => !r.ok).map(r => ({url: r.url, attempt: r.attempt, error: r.error, addresses: r.addresses ? r.addresses.length : 0}));
  const finalFailures = unresolved.filter(u => u.reason.startsWith("request failed")).length;
  const displayed = rows.filter(r => !r.hidden);
  return {
    schemaVersion: config.schemaVersion,
    scope,
    chain,
    runId,
    producer,
    discoveryUrl: discovery.discoveryUrl,
    discoveryAt: discovery.observedAt,
    discoveryStatus: discovery.status,
    metrics: {
      window: {from: okTimes[0] || null, to: metricsAt},
      requests: requests.length,
      failedRequests,
    },
    marketStatus: !okTimes.length ? "failed" : (unresolved.length || unexpected.length || finalFailures ? "partial" : "complete"),
    counts: {
      discoveredPools: discovery.pools.length,
      resolvedPools: byPair.size,
      unresolvedPools: unresolved.length,
      unexpectedPools: unexpected.length,
      excludedPools: excludedPools.length,
      tokens: rows.length,
      hiddenTokens: rows.length - displayed.length,
      displayedTokens: displayed.length,
    },
    unresolvedPools: unresolved,
    unexpectedPools: unexpected,
    excludedPools,
    filterRecheck: recheck,
    rows,
  };
}

module.exports = {aggregate, compareRows, sumField};
