"use strict";
const {finite, formatUsd, formatPercent, round} = require("./util.cjs");

const DAY = 86400 * 1000;

// Measured facts are generated from observations and chain reads only, never by the model.
function measuredFacts(row, {metricsAt, chainFacts, prior, recentPoolDays = 7} = {}) {
  const facts = [];
  const add = (key, text) => facts.push({key: `measured:${key}`, text});
  const vol = row.volume24h.value;
  const liq = row.liquidity.value;
  if (finite(vol) && finite(liq) && liq > 0) add("volumeToLiquidity", `24h volume ${formatUsd(vol)} is ${round(vol / liq, 1)}× pooled liquidity ${formatUsd(liq)}`);
  const dexes = [...new Set(row.pools.map(p => p.dexId).filter(Boolean))];
  const quotes = [...new Set(row.pools.map(p => p.quote.symbol).filter(Boolean))];
  add("pools", `${row.pools.length} qualifying pool${row.pools.length === 1 ? "" : "s"} on ${dexes.join(", ") || "unknown DEX"}, quoted in ${quotes.join(", ") || "unknown"}`);
  if (row.oldestPoolAt) {
    const ageDays = metricsAt ? (Date.parse(metricsAt) - Date.parse(row.oldestPoolAt)) / DAY : null;
    const recent = finite(ageDays) && ageDays <= recentPoolDays;
    add("poolAge", `Oldest qualifying pool created ${row.oldestPoolAt.slice(0, 10)}${finite(ageDays) ? ` (${ageDays.toFixed(1)} days before the read)` : ""}; pool creation, not a launch date${recent ? "; recent pool" : ""}`);
  } else {
    add("poolAge", "Pool creation time unavailable from the pair API");
  }
  for (const flag of row.flags) {
    if (flag.code === "mcapExceedsFdv") add("valuation", `Reported market cap ${formatUsd(row.marketCap)} exceeds FDV ${formatUsd(row.fdv)} (${flag.ratio}×) on the most liquid pool; valuation unreconciled`);
    if (flag.code === "fdvSpread") add("fdvSpread", `FDV differs across pools: ${formatUsd(flag.min)} to ${formatUsd(flag.max)}`);
    if (flag.code === "changeSpread") add("changeSpread", `24h change ranges ${formatPercent(flag.min)} to ${formatPercent(flag.max)} across pools`);
    if (flag.code === "volumePartial") add("volumePartial", `24h volume sums ${flag.pools} pools; the others reported no value`);
    if (flag.code === "liquidityPartial") add("liquidityPartial", `Liquidity sums ${flag.pools} pools; the others reported no value`);
    if (flag.code === "suspectedStableNotExcluded") add("suspectedStable", "Name or symbol resembles a stablecoin, but the contract is not on the exclusion list, so the row is kept");
  }
  if (row.valuation.metric === "fdv") add("valuationMetric", "Market cap unavailable; FDV shown and labelled");
  if (row.alsoQuotedIn.length) {
    const total = row.alsoQuotedIn.reduce((s, r) => s + (finite(r.volume24h) ? r.volume24h : 0), 0);
    add("alsoQuotedIn", `Also the quote token in ${row.alsoQuotedIn.length} pool${row.alsoQuotedIn.length === 1 ? "" : "s"} credited to ${[...new Set(row.alsoQuotedIn.map(r => r.baseSymbol))].join(", ")} (${formatUsd(total)} 24h volume, not counted here)`);
  }
  if (chainFacts && chainFacts.mint) {
    const m = chainFacts.mint;
    add("mintAuthority", `${m.program === "spl-token-2022" ? "Token-2022" : "SPL token"} mint: mint authority ${m.mintAuthority ? "set" : "none"}, freeze authority ${m.freezeAuthority ? "set" : "none"}, ${m.decimals} decimals`);
  }
  if (chainFacts && chainFacts.registry && chainFacts.registry.self) {
    const r = chainFacts.registry.self;
    add("stockToken", `Listed in Robinhood's stock-token registry as ${r.symbol} (${r.name}), status ${r.status}`);
  }
  if (chainFacts && chainFacts.registry && chainFacts.registry.quotes && chainFacts.registry.quotes.length) {
    add("stockQuote", `Pools quoted in Robinhood stock token${chainFacts.registry.quotes.length === 1 ? "" : "s"} ${chainFacts.registry.quotes.map(q => q.symbol).join(", ")}`);
  }
  if (prior) {
    const parts = [];
    if (finite(prior.volume24h)) parts.push(`24h volume ${formatUsd(prior.volume24h)}`);
    if (finite(prior.change24h)) parts.push(`24h change ${formatPercent(prior.change24h)}`);
    if (finite(prior.pools)) parts.push(`${prior.pools} pools`);
    add("vsPrior", `Previous compatible scan (${prior.observedAt.slice(0, 10)}): ${parts.join(", ") || "listed"}`);
  }
  return facts;
}

module.exports = {measuredFacts};
