#!/usr/bin/env node

/**
 * daily.mjs — run the daily scan for EVERY user account and build one
 * combined email digest of the roles discovered today.
 *
 * For each user: runs scan.mjs against their own data dir + saved
 * searches, then collects the rows first seen today. Writes
 * data/daily-digest.html (+ .md) and emits new_count for the workflow.
 *
 * Intended for the GitHub Actions cron. Needs the search API keys in env.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { userPaths, userEnv } from './storage.mjs';

const AUTO=['greenhouse.io','lever.co','ashbyhq.com','workable.com','smartrecruiters.com','jobvite.com','breezy.hr'];
const MAN=['linkedin.com','indeed.com','myworkdayjobs.com','workday.com','taleo.net','icims.com','glassdoor.com','ziprecruiter.com','dice.com','monster.com','simplyhired.com','adzuna.com'];
const hostOf=u=>{try{return new URL(u).hostname.toLowerCase().replace(/^www\./,'')}catch{return''}};
const cls=h=>!h?'REVIEW':AUTO.some(x=>h.includes(x))?'AUTO':MAN.some(x=>h.includes(x))?'MANUAL':'REVIEW';
const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const date=new Date().toISOString().slice(0,10);
function userDirs(){ try { return readdirSync('data/users',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name); } catch { return []; } }
const uids=userDirs();
let totalNew=0; let sections='';

function newRowsToday(P){
  if(!existsSync(P.history)) return [];
  const seen=new Set(); const rows=[];
  for(const line of readFileSync(P.history,'utf-8').split('\n').slice(1)){
    if(!line.trim()) continue;
    const p=line.split('\t'); const [url,first_seen,portal,title,company]=p;
    if(!url||seen.has(url)) continue; seen.add(url);
    if(first_seen!==date) continue;
    rows.push({ url, portal, title:title||'', company:company||'Unknown', queue:cls(hostOf(url)) });
  }
  return rows;
}
function listHtml(items){
  if(!items.length) return '<p style="color:#888;margin:4px 0">None.</p>';
  return '<ul style="margin:4px 0 14px;padding-left:18px">'+items.slice(0,60).map(r=>
    `<li style="margin:5px 0"><b>${esc(r.company)}</b> — ${esc(r.title)} <span style="color:#888">(${esc(r.portal)})</span><br><a href="${esc(r.url)}">${esc(r.url)}</a></li>`).join('')+'</ul>';
}

for(const uid of uids){
  const P=userPaths(uid);
  let label=uid.slice(0,8);
  try{ const prof=yaml.load(readFileSync(P.profile,'utf-8')); label=prof?.candidate?.full_name||prof?.candidate?.email||label; }catch{}
  console.log(`Scanning account ${label}…`);
  spawnSync('node',['scan.mjs'],{ env:userEnv(uid), stdio:'inherit' });
  const rows=newRowsToday(P);
  totalNew+=rows.length;
  const q={ AUTO:rows.filter(x=>x.queue==='AUTO'), MANUAL:rows.filter(x=>x.queue==='MANUAL'), REVIEW:rows.filter(x=>x.queue==='REVIEW') };
  sections+=`<h2 style="margin:20px 0 2px">${esc(label)}</h2>`+
    `<p style="color:#666;margin:0 0 10px">${rows.length} new today · ✅ ${q.AUTO.length} · ✋ ${q.MANUAL.length} · 🔎 ${q.REVIEW.length}</p>`+
    `<h3 style="margin:12px 0 4px">✅ Auto</h3>${listHtml(q.AUTO)}`+
    `<h3 style="margin:12px 0 4px">✋ Manual</h3>${listHtml(q.MANUAL)}`+
    `<h3 style="margin:12px 0 4px">🔎 Review</h3>${listHtml(q.REVIEW)}`;
}

const html=`<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:660px">
<h1 style="margin:0 0 2px">career-ops daily — ${date}</h1>
<p style="color:#666;margin:0 0 6px">${totalNew} new role(s) across ${uids.length} account(s).</p>
${sections||'<p>No accounts yet.</p>'}
</div>`;
writeFileSync('data/daily-digest.html', html, 'utf-8');
writeFileSync('data/daily-digest.md', `# career-ops daily — ${date}\n\n${totalNew} new across ${uids.length} account(s)\n`, 'utf-8');
if(process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `new_count=${totalNew}\ndigest_date=${date}\n`, { flag:'a' });
console.log(`Daily digest: ${totalNew} new across ${uids.length} account(s) → data/daily-digest.html`);
