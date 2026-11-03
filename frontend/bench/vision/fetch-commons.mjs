#!/usr/bin/env node
/**
 * Resolves commons-list.json via the Wikimedia Commons API (license, author, 640 px thumbnail),
 * writes commons-manifest.json (committed: provenance only) and downloads freely licensed images into
 * .cache/commons/ (gitignored). Non-free or unknown licenses are recorded and skipped.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.cache', 'commons');
mkdirSync(OUT, { recursive: true });
const { items } = JSON.parse(readFileSync(join(HERE, 'commons-list.json'), 'utf8'));
const FREE = /^(CC0|Public domain|PD|No restrictions|CC BY(-SA)? \d(\.\d)?)/i;
const UA = { 'user-agent': 'study-monitor-vision-bench/1.0 (research benchmark)' };
const strip = (h) => String(h ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function get(url, asJson) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, { headers: UA });
    if (r.status === 429 || r.status >= 500) {
      await sleep(5_000 * (attempt + 1));
      continue;
    }
    const body = asJson ? await r.text() : Buffer.from(await r.arrayBuffer());
    if (asJson && body.startsWith('You are making too many')) {
      await sleep(10_000 * (attempt + 1));
      continue;
    }
    return { ok: r.ok, status: r.status, body: asJson ? JSON.parse(body) : body };
  }
  throw new Error(`rate limited: ${url}`);
}

// One API request for all titles (≤ 50 per request).
const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=640&titles=${encodeURIComponent(items.map((it) => 'File:' + it.title).join('|'))}`;
const { body: j } = await get(api, true);
const norm = new Map((j.query.normalized ?? []).map((n) => [n.from, n.to]));
const pages = new Map(Object.values(j.query.pages).map((p) => [p.title, p]));

const out = [];
for (const [i, it] of items.entries()) {
  const t = 'File:' + it.title;
  const page = pages.get(norm.get(t) ?? t);
  const ii = page?.imageinfo?.[0];
  if (!ii) {
    out.push({ ...it, status: 'missing' });
    continue;
  }
  const md = ii.extmetadata ?? {};
  const license = strip(md.LicenseShortName?.value);
  const rec = {
    ...it,
    file: `commons_${String(i).padStart(2, '0')}.jpg`,
    descriptionUrl: ii.descriptionurl,
    thumbUrl: ii.thumburl,
    license,
    licenseUrl: strip(md.LicenseUrl?.value) || null,
    artist: strip(md.Artist?.value).slice(0, 200),
    originalSize: `${ii.width}×${ii.height}`,
  };
  if (!FREE.test(license)) {
    out.push({ ...rec, status: 'skipped: license not free/unknown' });
    continue;
  }
  const r = await get(ii.thumburl, false);
  if (!r.ok) {
    out.push({ ...rec, status: `download failed HTTP ${r.status}` });
    continue;
  }
  writeFileSync(join(OUT, rec.file), r.body);
  out.push({ ...rec, status: 'ok' });
  await sleep(1_500); // be polite
}
writeFileSync(join(HERE, 'commons-manifest.json'), JSON.stringify({ source: 'Wikimedia Commons', generatedBy: 'fetch-commons.mjs', items: out }, null, 1) + '\n');
for (const o of out) console.log(o.status.padEnd(10), o.situation.padEnd(22), o.license ?? '', '|', o.title);
