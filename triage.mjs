#!/usr/bin/env node

/**
 * triage.mjs — split discovered jobs into actionable queues.
 *
 * Reads scan's real output (data/scan-history.tsv) and classifies each
 * job by the ATS host of its apply URL:
 *
 *   AUTO    Greenhouse / Lever / Ashby / Workable / SmartRecruiters —
 *           pre-fillable; you review + click submit.
 *   MANUAL  LinkedIn / Indeed / Workday / Taleo / iCIMS / Glassdoor /
 *           ZipRecruiter / Dice — login / CAPTCHA / Easy-Apply walls.
 *           Printed as an "apply to these yourself" list.
 *   REVIEW  Unknown ATS — eyeball before deciding. Nothing is dropped.
 *
 * Usage:
 *   node triage.mjs                 # all jobs in scan-history.tsv
 *   node triage.mjs --days 7        # only jobs first seen in last 7 days
 *   node triage.mjs --source jsearch  # only jobs from a given source/portal
 *
 * Writes data/triage.md and prints a summary.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const TRIAGE_PATH = 'data/triage.md';

// host substring -> queue
const AUTO_HOSTS = [
  'greenhouse.io', 'boards.greenhouse.io', 'job-boards.greenhouse.io',
  'lever.co', 'jobs.lever.co',
  'ashbyhq.com', 'jobs.ashbyhq.com',
  'workable.com',
  'smartrecruiters.com',
  'jobvite.com',
  'breezy.hr',
];
const MANUAL_HOSTS = [
  'linkedin.com',
  'indeed.com',
  'myworkdayjobs.com', 'workday.com', 'wd1.', 'wd3.', 'wd5.',
  'taleo.net',
  'icims.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'dice.com',
  'monster.com',
  'simplyhired.com',
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function classify(url) {
  const host = hostOf(url);
  if (!host) return 'REVIEW';
  if (AUTO_HOSTS.some(h => host.includes(h))) return 'AUTO';
  if (MANUAL_HOSTS.some(h => host.includes(h))) return 'MANUAL';
  return 'REVIEW';
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { days: null, source: null };
  const di = args.indexOf('--days');
  if (di !== -1) out.days = parseInt(args[di + 1], 10);
  const si = args.indexOf('--source');
  if (si !== -1) out.source = (args[si + 1] || '').toLowerCase();
  return out;
}

function loadRows() {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    console.error(`Error: ${SCAN_HISTORY_PATH} not found. Run "node scan.mjs" first.`);
    process.exit(1);
  }
  const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [url, first_seen, portal, title, company, status] = line.split('\t');
    if (!url) continue;
    rows.push({ url, first_seen, portal, title, company, status });
  }
  return rows;
}

function withinDays(dateStr, days) {
  if (!days) return true;
  const d = new Date(dateStr);
  if (isNaN(d)) return true;
  const cutoff = Date.now() - days * 86400_000;
  return d.getTime() >= cutoff;
}

function main() {
  const { days, source } = parseArgs();
  let rows = loadRows();

  // De-dupe by URL (history can hold repeats across scans).
  const byUrl = new Map();
  for (const r of rows) if (!byUrl.has(r.url)) byUrl.set(r.url, r);
  rows = [...byUrl.values()];

  if (days) rows = rows.filter(r => withinDays(r.first_seen, days));
  if (source) rows = rows.filter(r => (r.portal || '').toLowerCase().includes(source));

  const queues = { AUTO: [], MANUAL: [], REVIEW: [] };
  for (const r of rows) queues[classify(r.url)].push(r);

  const sortByCompany = (a, b) =>
    (a.company || '').localeCompare(b.company || '') ||
    (a.title || '').localeCompare(b.title || '');
  for (const q of Object.values(queues)) q.sort(sortByCompany);

  // ── Console summary ──
  const total = rows.length;
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`Triage — ${total} jobs` +
    (days ? ` (last ${days}d)` : '') +
    (source ? ` (source: ${source})` : ''));
  console.log(`${'━'.repeat(50)}`);
  console.log(`✅ AUTO   (pre-fillable, you review+submit): ${queues.AUTO.length}`);
  console.log(`✋ MANUAL (apply yourself — login/CAPTCHA):   ${queues.MANUAL.length}`);
  console.log(`🔎 REVIEW (unknown ATS — eyeball first):      ${queues.REVIEW.length}`);

  // ── Markdown report ──
  const section = (emoji, name, blurb, items) => {
    let md = `\n## ${emoji} ${name} (${items.length})\n\n${blurb}\n\n`;
    if (items.length === 0) return md + '_None._\n';
    for (const r of items) {
      md += `- [ ] **${r.company}** — ${r.title}` +
        (r.portal ? `  _(${r.portal})_` : '') +
        `\n  ${r.url}\n`;
    }
    return md;
  };

  const today = new Date().toISOString().slice(0, 10);
  let md = `# Triage queues — ${today}\n\n`;
  md += `Total jobs: ${total}` +
    (days ? ` · window: last ${days} days` : '') +
    (source ? ` · source: ${source}` : '') + '\n';
  md += section('✅', 'AUTO — agent can pre-fill, you review + submit',
    'Greenhouse / Lever / Ashby / Workable. career-ops can tailor your CV and pre-fill these. Nothing is auto-submitted.',
    queues.AUTO);
  md += section('✋', 'MANUAL — apply to these yourself',
    'LinkedIn / Indeed / Workday / Taleo / iCIMS and other login/CAPTCHA/Easy-Apply walls. Use the direct links below.',
    queues.MANUAL);
  md += section('🔎', 'REVIEW — unknown ATS, decide before applying',
    'Host did not match a known ATS. Open and decide AUTO vs MANUAL.',
    queues.REVIEW);

  writeFileSync(TRIAGE_PATH, md, 'utf-8');
  console.log(`\nWritten to ${TRIAGE_PATH}`);
}

main();
