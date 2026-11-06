#!/usr/bin/env node
/**
 * Fetches GitHub Releases asset download counts and appends an hourly snapshot
 * to docs/download-stats.json (used by the GitHub Pages dashboard).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../docs/download-stats.json');
const REPO = process.env.GITHUB_REPOSITORY || 'kazuya83/worktree-kanban';
const TOKEN = process.env.GITHUB_TOKEN;
/** Keep roughly this many days of hourly points (cron = 1/hour). */
const MAX_SNAPSHOT_DAYS = 120;

async function fetchAllReleases() {
  const [owner, repo] = REPO.split('/');
  let page = 1;
  const all = [];
  for (;;) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    page += 1;
  }
  return all;
}

function sumDownloads(releases) {
  return releases.reduce((sum, r) => {
    const assets = r.assets || [];
    return sum + assets.reduce((s, a) => s + (a.download_count || 0), 0);
  }, 0);
}

function loadExisting() {
  try {
    const raw = fs.readFileSync(OUT, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { repo: REPO, snapshots: [] };
  }
}

function trimSnapshots(snapshots) {
  const cutoff = Date.now() - MAX_SNAPSHOT_DAYS * 24 * 60 * 60 * 1000;
  return snapshots.filter((s) => {
    const t = new Date(s.t).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function upsertHourlySnapshot(snapshots, tIso, total) {
  const hourKey = tIso.slice(0, 13); // YYYY-MM-DDTHH
  const next = [...snapshots];
  const idx = next.findIndex((s) => typeof s.t === 'string' && s.t.slice(0, 13) === hourKey);
  const row = { t: tIso, total };
  if (idx >= 0) next[idx] = row;
  else next.push(row);
  next.sort((a, b) => new Date(a.t) - new Date(b.t));
  return next;
}

async function main() {
  const releases = await fetchAllReleases();
  const total = sumDownloads(releases);
  const now = new Date().toISOString();

  const data = loadExisting();
  data.repo = REPO;
  data.updatedAt = now;
  data.snapshots = trimSnapshots(data.snapshots || []);
  data.snapshots = upsertHourlySnapshot(data.snapshots, now, total);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUT} (total downloads: ${total}, snapshots: ${data.snapshots.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
