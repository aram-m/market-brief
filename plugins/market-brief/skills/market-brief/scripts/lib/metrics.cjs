"use strict";
const {chunk, errorMessage, sleep} = require("./util.cjs");

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function pickHeaders(headers) {
  const get = name => (headers && typeof headers.get === "function" ? headers.get(name) : null);
  return {date: get("date"), age: get("age"), cacheControl: get("cache-control"), cfCacheStatus: get("cf-cache-status"), cfRay: get("cf-ray"), cfMitigated: get("cf-mitigated")};
}

// Fetches pair metrics sequentially in batches; every attempt is recorded, successful batches are kept.
async function fetchPairs({chain, slugs, config, budget, fetchImpl = fetch, sleepImpl = sleep, clock = () => new Date()}) {
  const {batchSize, timeoutMs, pairsEndpoint} = config.dexscreener;
  const retries = config.budget.retriesPerCall;
  const requests = [];
  const responses = [];
  for (const batch of chunk(slugs, batchSize)) {
    const url = pairsEndpoint.replace("{chain}", chain).replace("{addresses}", batch.join(","));
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      if (!budget.take("pairCallsPerRun")) {
        requests.push({url, addresses: batch, attempt, ok: false, error: "request budget exhausted (pairCallsPerRun)", requestedAt: clock().toISOString()});
        break;
      }
      const requestedAt = clock().toISOString();
      let record;
      try {
        const res = await fetchImpl(url, {headers: {accept: "application/json"}, signal: AbortSignal.timeout(timeoutMs)});
        record = {url, addresses: batch, attempt, requestedAt, receivedAt: clock().toISOString(), status: res.status, headers: pickHeaders(res.headers)};
        if (res.ok) {
          const data = await res.json();
          const pairs = Array.isArray(data && data.pairs) ? data.pairs : (data && data.pair ? [data.pair] : []);
          record.ok = true;
          record.returned = pairs.length;
          requests.push(record);
          responses.push({url, receivedAt: record.receivedAt, pairs});
          break;
        }
        record.ok = false;
        record.error = `HTTP ${res.status}${record.headers.cfMitigated ? ` (cf-mitigated: ${record.headers.cfMitigated})` : ""}`;
        requests.push(record);
        if (!RETRYABLE.has(res.status)) break;
      } catch (error) {
        requests.push({url, addresses: batch, attempt, requestedAt, receivedAt: clock().toISOString(), ok: false, error: errorMessage(error)});
      }
      if (attempt <= retries) await sleepImpl(1000 * 3 ** (attempt - 1));
    }
  }
  return {requests, responses};
}

module.exports = {fetchPairs, pickHeaders};
