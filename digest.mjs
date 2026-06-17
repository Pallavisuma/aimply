#!/usr/bin/env node

/**
 * digest.mjs — build a daily email digest of NEW jobs.
 *
 * Reads data/scan-history.tsv, takes rows first seen today (the rows the
 * morning scan just added), classifies them into AUTO/MANUAL/REVIEW, and
 * writes data/digest.html (email body) + data/digest.md. Prints a one-line
 * summary to stdout for the workflow log.
 *
 * Usage: node digest.mjs            (today, UTC)
 *        node digest.mjs 2026-06-02 (a specific date)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DATA_DIR = process.env.CAREER_OPS_DATA_DIR || 'data';
const SCAN_HISTORY_PATH = `${DATA_DIR}/scan-history.tsv`;
const AUTO_HOSTS = ['greenhouse.io','lever.co','ashbyhq.com','workable.com','smartrecruiters.com','jobvite.com','breezy.hr'];
const MANUAL_HOSTS = ['linkedin.com','indeed.com','myworkdayjobs.com','workday.com','taleo.net','icims.com','glassdoor.com','ziprecruiter.com','dice.com','monster.com','simplyhired.com','adzuna.com'];

const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; } };
function classify(h){ if(!h) return 'REVIEW'; if(AUTO_HOSTS.some(x=>h.includes(x))) return 'AUTO'; if(MANUAL_HOSTS.some(x=>h.includes(x))) return 'MANUAL'; return 'REVIEW'; }
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const date = process.argv[2] || new Date().toISOString().slice(0,10);

let rows = [];
if (existsSync(SCAN_HISTORY_PATH)) {
  const lines = readFileSync(SCAN_HISTORY_PATH,'utf-8').split('\n').slice(1);
  const seen = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    const [url, first_seen, portal, title, company] = line.split('\t');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    if (first_seen !== date) continue;
    rows.push({ url, portal, title:title||'', company:company||'Unknown', queue:classify(hostOf(url)) });
  }
}

const q = { AUTO:rows.filter(r=>r.queue==='AUTO'), MANUAL:rows.filter(r=>r.queue==='MANUAL'), REVIEW:rows.filter(r=>r.queue==='REVIEW') };
const total = rows.length;

function listHtml(items){
  if(!items.length) return '<p style="color:#888;margin:4px 0">None.</p>';
  return '<ul style="margin:4px 0 14px;padding-left:18px">' + items.map(r =>
    `<li style="margin:5px 0"><b>${esc(r.company)}</b> — ${esc(r.title)} <span style="color:#888">(${esc(r.portal)})</span><br><a href="${esc(r.url)}">${esc(r.url)}</a></li>`
  ).join('') + '</ul>';
}

const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
<h2 style="margin:0 0 2px">career-ops — ${date}</h2>
<p style="color:#666;margin:0 0 14px">${total} new role${total===1?'':'s'} discovered · ✅ ${q.AUTO.length} auto · ✋ ${q.MANUAL.length} manual · 🔎 ${q.REVIEW.length} review</p>
<h3 style="margin:14px 0 4px">✅ Auto — pre-fillable (you review + submit)</h3>${listHtml(q.AUTO)}
<h3 style="margin:14px 0 4px">✋ Manual — apply yourself</h3>${listHtml(q.MANUAL)}
<h3 style="margin:14px 0 4px">🔎 Review — eyeball first</h3>${listHtml(q.REVIEW)}
<p style="color:#999;font-size:12px;margin-top:18px">Open the full dashboard locally with <code>npm run serve</code>, or the committed <code>data/dashboard.html</code>.</p>
</div>`;

const md = `# career-ops — ${date}\n\n${total} new roles · ${q.AUTO.length} auto / ${q.MANUAL.length} manual / ${q.REVIEW.length} review\n`;
writeFileSync(`${DATA_DIR}/digest.html`, html, 'utf-8');
writeFileSync(`${DATA_DIR}/digest.md`, md, 'utf-8');

// Expose count for the workflow (skip email when 0).
if (process.env.GITHUB_OUTPUT) {
  writeFileSync(process.env.GITHUB_OUTPUT, `new_count=${total}\ndigest_date=${date}\n`, { flag:'a' });
}
console.log(`Digest ${date}: ${total} new (${q.AUTO.length} auto / ${q.MANUAL.length} manual / ${q.REVIEW.length} review)`);
