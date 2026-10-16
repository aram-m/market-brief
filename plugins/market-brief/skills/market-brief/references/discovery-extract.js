(async () => {
  const fnv1a = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  const rowSelector = ".ds-dex-table > a[href]";
  const blocked = () => /just a moment|attention required/i.test(document.title) || !!document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, #challenge-form') || /verify you are human/i.test(document.body ? document.body.innerText : "");
  const started = Date.now();
  let rows = [];
  while (Date.now() - started < 20000) {
    rows = [...document.querySelectorAll(rowSelector)];
    if (rows.length || blocked()) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 1500));
  rows = [...document.querySelectorAll(rowSelector)];
  const text = document.body ? document.body.innerText : "";
  const slugs = rows.map(a => (a.getAttribute("href") || "").split("?")[0].split("/").pop());
  return {
    extractor: "market-brief/discovery-extract@1",
    url: location.href,
    title: document.title,
    observedAt: new Date().toISOString(),
    challenge: blocked(),
    filtersIndicator: (text.match(/Filters\s*\d+/) || [null])[0],
    rankBy: new URL(location.href).searchParams.get("rankBy"),
    rowCount: rows.length,
    nextPage: !!document.querySelector('a[href*="/page-2"]'),
    slugs,
    checksum: fnv1a(slugs.join("\n")),
  };
})()
