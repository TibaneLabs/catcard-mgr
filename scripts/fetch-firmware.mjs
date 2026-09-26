#!/usr/bin/env node
// Mirror CatCard release images into the site, so the page can download them.
//
// GitHub serves release assets from a host that sends no CORS headers, so a browser page
// cannot fetch them directly. The Pages build copies them next to the site instead, and
// writes `firmware/index.json` describing what it copied. Every image is checked against
// the release's own SHA256SUMS before it is kept.
//
//   node scripts/fetch-firmware.mjs                 mirror into public/firmware/
//   node scripts/fetch-firmware.mjs --fingerprint   print what a mirror would hold, and stop
//
// Environment: GITHUB_TOKEN (optional, raises the API rate limit), FIRMWARE_REPO
// (default TibaneLabs/catcard), FIRMWARE_KEEP (releases to mirror, default 5),
// FIRMWARE_OUT (default public/firmware).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint, parseAssetName, parseSums } from './firmware-catalog.mjs';

const REPO = process.env.FIRMWARE_REPO ?? 'TibaneLabs/catcard';
const KEEP = Number(process.env.FIRMWARE_KEEP ?? 5);
const OUT = process.env.FIRMWARE_OUT ?? 'public/firmware';
const token = process.env.GITHUB_TOKEN;

function headers(accept) {
  const h = { Accept: accept, 'User-Agent': 'catcard-mgr-build', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function api(path) {
  const r = await fetch(`https://api.github.com/${path}`, { headers: headers('application/vnd.github+json') });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function asset(a) {
  const r = await fetch(a.url, { headers: headers('application/octet-stream'), redirect: 'follow' });
  if (!r.ok) throw new Error(`download ${a.name}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

async function main() {
  const all = await api(`repos/${REPO}/releases?per_page=30`);
  const releases = all.filter((r) => !r.draft).slice(0, KEEP);

  if (process.argv.includes('--fingerprint')) {
    console.log(await fingerprint(releases));
    return;
  }

  const manifest = { repo: REPO, generated: new Date().toISOString(), fingerprint: await fingerprint(releases), releases: [] };
  const keptDirs = new Set();

  for (const rel of releases) {
    const sumsAsset = rel.assets.find((a) => a.name === 'SHA256SUMS');
    if (!sumsAsset) {
      console.warn(`${rel.tag_name}: no SHA256SUMS, skipped`);
      continue;
    }
    const sums = parseSums((await asset(sumsAsset)).toString('utf8'));
    const dir = join(OUT, rel.tag_name);
    await mkdir(dir, { recursive: true });
    keptDirs.add(rel.tag_name);
    const images = [];
    for (const a of rel.assets) {
      const meta = parseAssetName(a.name);
      if (!meta) continue;
      const want = sums.get(a.name);
      if (!want) {
        console.warn(`${rel.tag_name}/${a.name}: not in SHA256SUMS, skipped`);
        continue;
      }
      const file = join(dir, a.name);
      let bytes = existsSync(file) ? await readFile(file) : null;
      if (!bytes || sha256(bytes) !== want) {
        bytes = await asset(a);
        const got = sha256(bytes);
        if (got !== want) throw new Error(`${rel.tag_name}/${a.name}: SHA-256 ${got}, SHA256SUMS says ${want}`);
        await writeFile(file, bytes);
        console.log(`${rel.tag_name}/${a.name}: ${bytes.length} bytes, checked`);
      }
      images.push({ file: a.name, path: `firmware/${rel.tag_name}/${a.name}`, size: bytes.length, sha256: want, ...meta });
    }
    if (!images.length) continue;
    images.sort((x, y) => x.file.localeCompare(y.file));
    manifest.releases.push({
      tag: rel.tag_name,
      name: rel.name || rel.tag_name,
      prerelease: rel.prerelease,
      published: rel.published_at,
      url: rel.html_url,
      images,
    });
  }

  // Drop mirrored releases that fell out of the window.
  if (existsSync(OUT)) {
    const { readdir } = await import('node:fs/promises');
    for (const d of await readdir(OUT, { withFileTypes: true })) {
      if (d.isDirectory() && !keptDirs.has(d.name)) await rm(join(OUT, d.name), { recursive: true });
    }
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'index.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`firmware/index.json: ${manifest.releases.length} release(s)`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
