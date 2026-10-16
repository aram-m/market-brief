"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing file: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  return file;
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, text);
  return file;
}

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function parseArgs(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { out._.push(arg); continue; }
    const key = arg.slice(2);
    const eq = key.indexOf("=");
    if (eq >= 0) out[key.slice(0, eq)] = key.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return {year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second")};
}

function folderStamp(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return {day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}${p.minute}${p.second}`};
}

function formatLocalTime(iso, timeZone) {
  if (!iso) return "unavailable";
  const p = zonedParts(new Date(iso), timeZone);
  return `${p.hour}:${p.minute}`;
}

function formatLocalDate(iso, timeZone) {
  if (!iso) return "unavailable";
  return new Intl.DateTimeFormat("en-GB", {timeZone, day: "numeric", month: "short", year: "numeric"}).format(new Date(iso));
}

function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  return finite(n) ? n : null;
}

function round(n, digits = 2) {
  if (!finite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function errorMessage(error) {
  if (!error) return "unknown error";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
  const code = error.cause && (error.cause.code || error.cause.message);
  return code ? `${error.message} (${code})` : (error.message || String(error));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeAddress(address, caseSensitive) {
  const value = String(address || "").trim();
  return caseSensitive ? value : value.toLowerCase();
}

function tokenId(chain, address, caseSensitive) {
  return `${chain}:${normalizeAddress(address, caseSensitive)}`;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

function formatUsd(n) {
  if (!finite(n)) return "n/a";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(abs >= 1 ? 2 : 4)}`;
}

function formatPrice(n) {
  if (!finite(n)) return "n/a";
  if (n >= 1) return `$${n.toLocaleString("en-US", {maximumFractionDigits: 2})}`;
  return `$${n.toPrecision(4)}`;
}

function formatPercent(n) {
  if (!finite(n)) return "n/a";
  return `${n > 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}

module.exports = {
  readJson, writeJson, writeText, sha256, parseArgs, zonedParts, folderStamp, formatLocalTime, formatLocalDate,
  finite, toNumber, round, errorMessage, sleep, normalizeAddress, tokenId, chunk, mapLimit,
  formatUsd, formatPrice, formatPercent,
};
