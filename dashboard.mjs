#!/usr/bin/env node

/**
 * dashboard.mjs — generate a self-contained HTML dashboard.
 *
 * Reads data/scan-history.tsv, classifies each job by ATS host into
 * AUTO / MANUAL / REVIEW, and writes a single data/dashboard.html you
 * can double-click open (no server, no install). Re-run after each
 * scan to refresh. Includes a built-in Setup tab for API keys.
 *
 * Usage: node dashboard.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import { isUSLocation } from './location.mjs';

const DATA_DIR = process.env.CAREER_OPS_DATA_DIR || 'data';
const SCAN_HISTORY_PATH = `${DATA_DIR}/scan-history.tsv`;
const OUT_PATH = `${DATA_DIR}/dashboard.html`;
let US_ONLY=false, STRICT=false; try { const _lf=(yaml.load(readFileSync(process.env.CAREER_OPS_PORTALS||'portals.yml','utf-8')).location_filter)||{}; US_ONLY=!!_lf.us_only; STRICT=!!_lf.strict; } catch {}

const AUTO_HOSTS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com',
  'smartrecruiters.com', 'jobvite.com', 'breezy.hr',
];
const MANUAL_HOSTS = [
  'linkedin.com', 'indeed.com', 'myworkdayjobs.com', 'workday.com',
  'taleo.net', 'icims.com', 'glassdoor.com', 'ziprecruiter.com',
  'dice.com', 'monster.com', 'simplyhired.com', 'adzuna.com',
];

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
function classify(host) {
  if (!host) return 'REVIEW';
  if (AUTO_HOSTS.some(h => host.includes(h))) return 'AUTO';
  if (MANUAL_HOSTS.some(h => host.includes(h))) return 'MANUAL';
  return 'REVIEW';
}

function load() {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    console.error('No data/scan-history.tsv — run "node scan.mjs" first.');
    process.exit(1);
  }
  const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
  const seen = new Set();
  const jobs = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [url, first_seen, portal, title, company] = line.split('\t');
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const host = hostOf(url);
    jobs.push({
      company: company || 'Unknown',
      title: title || '',
      url,
      host,
      source: portal || '',
      firstSeen: first_seen || '',
      queue: classify(host),
    });
  }
  return jobs;
}

const jobs = load();
const counts = {
  total: jobs.length,
  AUTO: jobs.filter(j => j.queue === 'AUTO').length,
  MANUAL: jobs.filter(j => j.queue === 'MANUAL').length,
  REVIEW: jobs.filter(j => j.queue === 'REVIEW').length,
};
const sources = [...new Set(jobs.map(j => j.source).filter(Boolean))].sort();
const generated = new Date().toISOString().slice(0, 16).replace('T', ' ');

const dataJson = JSON.stringify(jobs).replace(/</g, '\\u003c');
const sourcesJson = JSON.stringify(sources).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>career-ops dashboard</title>
<style>
  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1e222b; --line:#2a2f3a;
    --txt:#e6e8ee; --muted:#9aa3b2; --accent:#7c9cff;
    --auto:#39d98a; --auto-bg:#0f2e22;
    --manual:#ffb454; --manual-bg:#2e2412;
    --review:#9aa3b2; --review-bg:#23262e;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  a{color:var(--accent);text-decoration:none}
  header{padding:22px 28px 10px;border-bottom:1px solid var(--line)}
  h1{margin:0;font-size:20px;letter-spacing:.2px}
  .sub{color:var(--muted);font-size:13px;margin-top:3px}
  .stats{display:flex;gap:12px;flex-wrap:wrap;padding:18px 28px}
  .stat{flex:1;min-width:130px;background:var(--panel);border:1px solid var(--line);
    border-radius:12px;padding:14px 16px;cursor:pointer;transition:.15s;user-select:none}
  .stat:hover{border-color:var(--accent)}
  .stat.active{outline:2px solid var(--accent)}
  .stat .n{font-size:26px;font-weight:700}
  .stat .l{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
  .stat.auto .n{color:var(--auto)} .stat.manual .n{color:var(--manual)} .stat.review .n{color:var(--review)}
  .toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:6px 28px 18px}
  input,select{background:var(--panel2);color:var(--txt);border:1px solid var(--line);
    border-radius:9px;padding:9px 12px;font-size:14px;outline:none}
  input:focus,select:focus{border-color:var(--accent)}
  #q{flex:1;min-width:220px}
  .btn{background:var(--panel2);border:1px solid var(--line);border-radius:9px;
    padding:9px 14px;color:var(--txt);cursor:pointer;font-size:14px}
  .btn:hover{border-color:var(--accent)}
  .btn.on{background:var(--accent);color:#0b0d12;border-color:var(--accent)}
  main{padding:0 28px 60px}
  .row{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--line);
    border-radius:11px;background:var(--panel);margin-bottom:8px}
  .row.done{opacity:.45}
  .row .meta{flex:1;min-width:0}
  .row .co{font-weight:650}
  .row .ti{color:var(--muted);font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
  .badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line);color:var(--muted)}
  .badge.q-AUTO{color:var(--auto);background:var(--auto-bg);border-color:transparent}
  .badge.q-MANUAL{color:var(--manual);background:var(--manual-bg);border-color:transparent}
  .badge.q-REVIEW{color:var(--review);background:var(--review-bg);border-color:transparent}
  .actions{display:flex;gap:8px;flex-shrink:0}
  .open{background:var(--accent);color:#0b0d12;border:none;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
  .mark{background:transparent;border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--muted);cursor:pointer}
  .mark:hover{border-color:var(--auto);color:var(--auto)}
  .empty{color:var(--muted);text-align:center;padding:60px 0}
  #setup{display:none;padding:8px 28px 50px;max-width:820px}
  #setup.show{display:block}
  #setup h2{font-size:17px;margin:22px 0 8px}
  #setup .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
  #setup code,#setup pre{background:#0b0d12;border:1px solid var(--line);border-radius:7px}
  #setup code{padding:2px 6px;font-size:13px}
  #setup pre{padding:12px 14px;overflow:auto;font-size:13px;margin:8px 0}
  #setup ol{margin:6px 0 0;padding-left:20px} #setup li{margin:5px 0}
  .pill{display:inline-block;font-size:11px;padding:2px 9px;border-radius:20px;margin-left:8px}
  .pill.auto{color:var(--auto);background:var(--auto-bg)}
  .pill.manual{color:var(--manual);background:var(--manual-bg)}
  .hide{display:none!important}
</style>
</head>
<body>
<header>
  <h1>career-ops dashboard <span id="setupToggle" class="btn" style="float:right;font-size:13px;padding:6px 12px">⚙️ Setup &amp; keys</span></h1>
  <div class="sub">Generated ${generated} · ${counts.total} unique jobs · re-run <code>node dashboard.mjs</code> after each scan to refresh</div>
</header>

<div id="setup">
  <div class="card">
    <h2>1 · Get your API keys (free)</h2>
    <p><b>JSearch</b> <span class="pill manual">market search</span> — catches LinkedIn/Indeed cross-posts.</p>
    <ol>
      <li>Open <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch" target="_blank">the JSearch API on RapidAPI</a> and sign up.</li>
      <li>Click <b>Subscribe to Test → Basic ($0)</b>.</li>
      <li>Go to <a href="https://rapidapi.com/developer/apps" target="_blank">My Apps</a> → your app → <b>Security</b> tab → reveal &amp; copy the <b>Application Key</b>. That's your <code>JSEARCH_API_KEY</code>.</li>
    </ol>
    <p style="margin-top:14px"><b>Adzuna</b> <span class="pill manual">market search</span> — free, includes salary data.</p>
    <ol>
      <li>Register at <a href="https://developer.adzuna.com/" target="_blank">developer.adzuna.com</a>.</li>
      <li>Create an app → copy the <b>Application ID</b> and <b>Application Key</b> (= <code>ADZUNA_APP_ID</code>, <code>ADZUNA_APP_KEY</code>).</li>
    </ol>
  </div>
  <div class="card">
    <h2>2 · Save them</h2>
    <p>Create a file named <code>.env</code> in the career-ops folder (it's git-ignored) containing:</p>
    <pre>JSEARCH_API_KEY=your_rapidapi_key
ADZUNA_APP_ID=your_adzuna_app_id
ADZUNA_APP_KEY=your_adzuna_app_key</pre>
    <p>No keys needed for the company scan (Greenhouse/Ashby/Lever) — those run regardless.</p>
  </div>
  <div class="card">
    <h2>3 · Run it (in your terminal, in this folder)</h2>
    <pre>node scan.mjs          <span style="color:var(--muted)"># discover jobs → pipeline + history</span>
node triage.mjs        <span style="color:var(--muted)"># split into AUTO / MANUAL / REVIEW</span>
node dashboard.mjs     <span style="color:var(--muted)"># rebuild this page</span></pre>
    <p>Then reopen this <code>dashboard.html</code> to see fresh results.</p>
  </div>
  <div class="card">
    <h2>What the queues mean</h2>
    <p><span class="badge q-AUTO">AUTO</span> Greenhouse/Lever/Ashby/Workable — career-ops can tailor your CV &amp; pre-fill the form. You review and click submit.</p>
    <p><span class="badge q-MANUAL">MANUAL</span> LinkedIn/Indeed/Workday/Taleo/iCIMS — login or CAPTCHA walls. Apply yourself using the link.</p>
    <p><span class="badge q-REVIEW">REVIEW</span> Unknown/branded career page — open and decide. Nothing is ever dropped.</p>
  </div>
</div>

<div id="app">
  <div class="stats">
    <div class="stat" data-q="ALL"><div class="n">${counts.total}</div><div class="l">All jobs</div></div>
    <div class="stat auto" data-q="AUTO"><div class="n">${counts.AUTO}</div><div class="l">✅ Auto · pre-fill</div></div>
    <div class="stat manual" data-q="MANUAL"><div class="n">${counts.MANUAL}</div><div class="l">✋ Manual · apply yourself</div></div>
    <div class="stat review" data-q="REVIEW"><div class="n">${counts.REVIEW}</div><div class="l">🔎 Review</div></div>
  </div>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search company or title…">
    <select id="src"><option value="">All sources</option></select>
    <button id="hideDone" class="btn">Hide applied</button>
    <span id="showing" class="sub" style="margin-left:auto"></span>
  </div>
  <main><div id="list"></div></main>
</div>

<script>
var JOBS = ${dataJson};
var SOURCES = ${sourcesJson};
var state = { q:"", queue:"ALL", src:"", hideDone:false };

function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function isDone(url){ return lsGet("applied:"+url) === "1"; }
function setDone(url,v){ lsSet("applied:"+url, v?"1":"0"); }

var srcSel = document.getElementById("src");
for (var i=0;i<SOURCES.length;i++){
  var o=document.createElement("option"); o.value=SOURCES[i]; o.textContent=SOURCES[i]; srcSel.appendChild(o);
}

function matches(j){
  if (state.queue!=="ALL" && j.queue!==state.queue) return false;
  if (state.src && j.source!==state.src) return false;
  if (state.hideDone && isDone(j.url)) return false;
  if (state.q){
    var s=(j.company+" "+j.title).toLowerCase();
    if (s.indexOf(state.q.toLowerCase())===-1) return false;
  }
  return true;
}

function render(){
  var list=document.getElementById("list");
  list.textContent="";
  var shown=JOBS.filter(matches);
  shown.sort(function(a,b){
    var da=isDone(a.url)?1:0, db=isDone(b.url)?1:0;
    if(da!==db) return da-db;
    return (a.company||"").localeCompare(b.company||"") || (a.title||"").localeCompare(b.title||"");
  });
  document.getElementById("showing").textContent="Showing "+shown.length+" of "+JOBS.length;
  if(shown.length===0){
    var e=document.createElement("div"); e.className="empty"; e.textContent="No jobs match. Try clearing filters or run a scan.";
    list.appendChild(e); return;
  }
  for (var i=0;i<shown.length;i++){
    var j=shown[i];
    var row=document.createElement("div"); row.className="row"+(isDone(j.url)?" done":"");

    var meta=document.createElement("div"); meta.className="meta";
    var co=document.createElement("div"); co.className="co"; co.textContent=j.company;
    var ti=document.createElement("div"); ti.className="ti"; ti.textContent=j.title;
    var badges=document.createElement("div"); badges.className="badges";
    function badge(txt,cls){ var b=document.createElement("span"); b.className="badge "+(cls||""); b.textContent=txt; return b; }
    badges.appendChild(badge(j.queue,"q-"+j.queue));
    if(j.source) badges.appendChild(badge(j.source));
    if(j.location) badges.appendChild(badge(j.location));
    if(j.host) badges.appendChild(badge(j.host));
    if(j.firstSeen) badges.appendChild(badge(j.firstSeen));
    meta.appendChild(co); meta.appendChild(ti); meta.appendChild(badges);

    var actions=document.createElement("div"); actions.className="actions";
    var open=document.createElement("a"); open.className="open"; open.textContent="Open ↗"; open.href=j.url; open.target="_blank"; open.rel="noopener";
    var mark=document.createElement("button"); mark.className="mark"; mark.textContent=isDone(j.url)?"✓ Applied":"Mark applied";
    (function(url,rowEl,markEl){
      markEl.onclick=function(){ var nv=!isDone(url); setDone(url,nv); render(); };
    })(j.url,row,mark);
    actions.appendChild(open); actions.appendChild(mark);

    row.appendChild(meta); row.appendChild(actions);
    list.appendChild(row);
  }
}

document.getElementById("q").addEventListener("input",function(e){ state.q=e.target.value; render(); });
srcSel.addEventListener("change",function(e){ state.src=e.target.value; render(); });
document.getElementById("hideDone").addEventListener("click",function(e){
  state.hideDone=!state.hideDone; e.target.classList.toggle("on",state.hideDone); render();
});

var stats=document.querySelectorAll(".stat");
for (var k=0;k<stats.length;k++){
  stats[k].addEventListener("click",function(){
    var q=this.getAttribute("data-q"); state.queue=q;
    for(var m=0;m<stats.length;m++) stats[m].classList.toggle("active", stats[m]===this);
    render();
  }.bind(stats[k]));
}

var setupOn=false;
document.getElementById("setupToggle").addEventListener("click",function(){
  setupOn=!setupOn;
  document.getElementById("setup").classList.toggle("show",setupOn);
  document.getElementById("app").classList.toggle("hide",setupOn);
  this.classList.toggle("on",setupOn);
});

render();
</script>
</body>
</html>`;

writeFileSync(OUT_PATH, html, 'utf-8');
console.log('Wrote ' + OUT_PATH + ' — ' + counts.total + ' jobs (' +
  counts.AUTO + ' AUTO / ' + counts.MANUAL + ' MANUAL / ' + counts.REVIEW + ' REVIEW)');
