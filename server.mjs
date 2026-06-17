#!/usr/bin/env node

/**
 * server.mjs — multi-user career-ops web app.
 *
 *   node server.mjs            # http://localhost:5173
 *
 * Each user signs up, logs in, and gets isolated data under
 * data/users/<uid>/. Pre-fill runs on the host machine's browser
 * (local companion). Auth is the built-in scrypt/session system.
 */

import http from 'http';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { extname, resolve, normalize, relative } from 'path';
import yaml from 'js-yaml';
import 'dotenv/config';
import * as jsearchProvider from './providers/jsearch.mjs';
import * as adzunaProvider from './providers/adzuna.mjs';
import * as remotiveProvider from './providers/remotive.mjs';
import * as themuseProvider from './providers/themuse.mjs';
import * as joobleProvider from './providers/jooble.mjs';
import { isUSLocation } from './location.mjs';
import * as auth from './auth.mjs';
import { userPaths, userEnv, seedUser } from './storage.mjs';
import * as supa from './supabase.mjs';

const PORT = process.env.PORT || 5173;
const APP_HTML = 'web/app.html';
const LOGIN_HTML = 'web/login.html';

mkdirSync('data', { recursive: true });

const AUTO_HOSTS = ['greenhouse.io','lever.co','ashbyhq.com','workable.com','smartrecruiters.com','jobvite.com','breezy.hr'];
const MANUAL_HOSTS = ['linkedin.com','indeed.com','myworkdayjobs.com','workday.com','taleo.net','icims.com','glassdoor.com','ziprecruiter.com','dice.com','monster.com','simplyhired.com','adzuna.com'];
const QUEUE_RANK = { AUTO:0, REVIEW:1, MANUAL:2 };
const USE_SUPA = supa.enabled;

const hostOf = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./,''); } catch { return ''; } };
const classify = h => !h ? 'REVIEW' : AUTO_HOSTS.some(x=>h.includes(x)) ? 'AUTO' : MANUAL_HOSTS.some(x=>h.includes(x)) ? 'MANUAL' : 'REVIEW';
const normTitle = t => (t||'').toLowerCase().replace(/\(.*?\)/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

/* ── per-user data helpers (all take a paths object) ── */
function fileReadProfile(P){
  try{ const y=yaml.load(readFileSync(P.profile,'utf-8'))||{}; const c=y.candidate||{}; return {
    full_name:c.full_name||'', email:c.email||'', phone:c.phone||'', location:c.location||'',
    linkedin:c.linkedin||'', github:c.github||'', portfolio_url:c.portfolio_url||'',
    work_authorization:(y.location&&y.location.visa_status)||c.work_authorization||'' }; }
  catch{ return {}; }
}
async function readProfile(P, uid){ return USE_SUPA ? await supa.getProfile(uid) : fileReadProfile(P); }
async function writeProfile(P, uid, f){
  if(USE_SUPA) return await supa.setProfile(uid, f);
  let y={}; try{ y=yaml.load(readFileSync(P.profile,'utf-8'))||{}; }catch{}
  y.candidate=y.candidate||{};
  for(const k of ['full_name','email','phone','location','linkedin','github','portfolio_url']) if(f[k]!==undefined) y.candidate[k]=f[k];
  if(f.work_authorization!==undefined){ y.location=y.location||{}; y.location.visa_status=f.work_authorization; }
  writeFileSync(P.profile, yaml.dump(y),'utf-8');
  return fileReadProfile(P);
}
function fileApps(P){ try { return JSON.parse(readFileSync(P.applications,'utf-8')); } catch { return {}; } }
async function loadApps(P, uid){ return USE_SUPA ? await supa.getApps(uid) : fileApps(P); }
async function setAppPatch(P, uid, url, patch){
  if(USE_SUPA) return void await supa.setApp(uid, url, patch);
  const a=fileApps(P); a[url]={ ...(a[url]||{}), ...patch }; writeFileSync(P.applications, JSON.stringify(a,null,2),'utf-8');
}

function locationOpts(P){
  try { const lf=(yaml.load(readFileSync(P.portals,'utf-8')).location_filter)||{}; return { usOnly:!!lf.us_only, strict:!!lf.strict }; }
  catch { return { usOnly:false, strict:false }; }
}
function buildNegativeFilter(P){
  try { const neg=(yaml.load(readFileSync(P.portals,'utf-8')).title_filter?.negative||[]).map(k=>k.toLowerCase());
    return (t,l)=>!neg.some(k=>(t||'').toLowerCase().includes(k)||(l||'').toLowerCase().includes(k)); }
  catch { return ()=>true; }
}
function dedupeRoles(jobs){
  const best=new Map();
  for(const j of jobs){
    const key=(j.company||'').toLowerCase().trim()+'::'+normTitle(j.title);
    const cur=best.get(key);
    if(!cur){ best.set(key,j); continue; }
    const score=x=>(x.applied?1000:0)+(x.tailoredResume?100:0)+(10-(QUEUE_RANK[x.queue]??9));
    if(score(j)>score(cur)) best.set(key,j);
  }
  return [...best.values()];
}
function relFile(P, p){ return p ? p.replace(P.dir+'/','') : null; }
function fileRows(P){
  const rows=[]; if(!existsSync(P.history)) return rows;
  for(const line of readFileSync(P.history,'utf-8').split('\n').slice(1)){
    if(!line.trim()) continue;
    const parts=line.split('\t'); rows.push({ url:parts[0], first_seen:parts[1], portal:parts[2], title:parts[3], company:parts[4], location:parts[6]||'', posted:parts[7]||'' });
  }
  return rows;
}
async function syncFileToSupabase(P, uid){
  const rows=fileRows(P); if(!rows.length) return 0;
  const byDate={}; for(const r of rows){ const d=r.first_seen||'1970-01-01'; (byDate[d]=byDate[d]||[]).push({ url:r.url, source:r.portal, title:r.title, company:r.company, location:r.location, posted:r.posted }); }
  for(const d of Object.keys(byDate)) await supa.addRows(uid, byDate[d], d);
  return rows.length;
}
async function loadJobs(P, uid){
  const rows = USE_SUPA ? await supa.getRows(uid) : fileRows(P);
  const apps = await loadApps(P, uid);
  const { usOnly, strict }=locationOpts(P);
  const seen=new Set(); const jobs=[];
  for(const r of rows){
    const url=r.url; if(!url||seen.has(url)) continue; seen.add(url);
    const location=r.location||'';
    if(usOnly && !isUSLocation(location,{strict})) continue;
    const a=apps[url]||{};
    jobs.push({ company:r.company||'Unknown', title:r.title||'', url, host:hostOf(url), source:r.portal||'', location, posted:r.posted||'',
      firstSeen:r.first_seen||'', queue:classify(hostOf(url)),
      tailoredResume: relFile(P,a.tailoredResume), tailoredAt:a.tailoredAt||null,
      applied:!!a.applied, appliedAt:a.appliedAt||null, resumeUsed: relFile(P,a.resumeUsed) });
  }
  return dedupeRoles(jobs);
}
async function seenUrls(P, uid){
  if(USE_SUPA) return await supa.getSeenUrls(uid);
  const s=new Set(); if(existsSync(P.history)) for(const l of readFileSync(P.history,'utf-8').split('\n').slice(1)){ const u=l.split('\t')[0]; if(u) s.add(u);} return s;
}
async function appendScanHistory(P, uid, jobs, date){
  if(USE_SUPA) return void await supa.addRows(uid, jobs, date);
  if(!existsSync(P.history)) writeFileSync(P.history,'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n','utf-8');
  appendFileSync(P.history, jobs.map(o=>`${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded\t${(o.location||'').replace(/\t/g,' ')}\t${(o.posted||'')}`).join('\n')+'\n','utf-8');
}
function appendPipeline(P,jobs){
  if(!jobs.length||!existsSync(P.pipeline)) return;
  let text=readFileSync(P.pipeline,'utf-8'); const marker='## Pendientes';
  const block=jobs.map(o=>`- [ ] ${o.url} | ${o.company} | ${o.title} | ${o.location||'Unknown'}`).join('\n');
  const idx=text.indexOf(marker);
  if(idx===-1) text+=`\n${marker}\n\n${block}\n`;
  else { const after=idx+marker.length; const next=text.indexOf('\n## ',after); const at=next===-1?text.length:next; text=text.slice(0,at)+'\n'+block+'\n'+text.slice(at); }
  writeFileSync(P.pipeline,text,'utf-8');
}
function windowParams(w){
  switch(w){
    case 'today': return { js:'today', adz:1 };
    case '3days': return { js:'3days', adz:3 };
    case 'week':  return { js:'week',  adz:7 };
    case 'any':   return { js:'all',   adz:60 };
    default:      return { js:'month', adz:30 };
  }
}
async function liveSearchTitles(P, uid, titles, win){
  const negOk=buildNegativeFilter(P); const { usOnly, strict:locStrict }=locationOpts(P);
  const seen=await seenUrls(P, uid); const date=new Date().toISOString().slice(0,10);
  const newJobs=[]; const errors=[]; let found=0; const bySource={};
  for(const title of titles){
    const t=(title||'').trim(); if(!t) continue;
    const W=windowParams(win);
    const entries=[
      { _p:jsearchProvider, provider:'jsearch', query:t, country:'us', date_posted:W.js, pages:3 },
      { _p:adzunaProvider, provider:'adzuna', query:t, country:'us', max_days_old:W.adz, results:50, pages:5 },
      { _p:remotiveProvider, provider:'remotive', query:t, results:100 },
      { _p:themuseProvider, provider:'themuse', query:t, pages:4 },
      { _p:joobleProvider, provider:'jooble', query:t, where:'United States', results:100 },
    ];
    for(const e of entries){
      try{ const jobs=await e._p.fetch(e); found+=jobs.length;
        for(const j of jobs){
          if(!j.url||!j.title) continue;
          if(!negOk(j.title,j.location)) continue;
          if(usOnly && !isUSLocation(j.location,{strict:locStrict})) continue;
          if(seen.has(j.url)) continue;
          seen.add(j.url); newJobs.push({...j, source:e.provider}); bySource[e.provider]=(bySource[e.provider]||0)+1;
        }
      }catch(err){ errors.push(`${e.provider} (${t}): ${err.message}`); }
    }
  }
  if(newJobs.length){ await appendScanHistory(P, uid, newJobs, date); if(!USE_SUPA) appendPipeline(P,newJobs); }
  return { found, added:newJobs.length, errors, bySource };
}

/* ── retarget (per user) ── */
const BLOCK_START='# >>> career-ops dynamic searches (managed by retarget) >>>';
const BLOCK_END='# <<< end dynamic searches <<<';
function addPositiveKeywords(P, roles){
  try{
    let t=readFileSync(P.portals,'utf-8');
    const m=t.match(/\n(\s*)positive:\s*\n/);
    if(!m) return;
    const indent=m[1]+'  ';
    const at=m.index+m[0].length;
    let add='';
    for(const r of roles){ const v=r.replace(/"/g,''); if(!t.includes('"'+v+'"')) add+=`${indent}- "${v}"\n`; }
    if(add){ t=t.slice(0,at)+add+t.slice(at); writeFileSync(P.portals,t,'utf-8'); }
  }catch(e){}
}
function writeSearchBlock(P,roles){
  let text=readFileSync(P.portals,'utf-8');
  const esc=x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  text=text.replace(new RegExp('\\n*'+esc(BLOCK_START)+'[\\s\\S]*?'+esc(BLOCK_END),'g'),'').replace(/\s+$/,'')+'\n';
  let block='\n'+BLOCK_START+'\n';
  for(const role of roles){ const r=role.replace(/"/g,'');
    block+=`  - name: "JSearch — ${r} (US)"\n    provider: jsearch\n    query: "${r}"\n    country: us\n    date_posted: week\n    pages: 1\n    enabled: true\n`;
    block+=`  - name: "Adzuna — ${r} (US)"\n    provider: adzuna\n    query: "${r}"\n    country: us\n    max_days_old: 7\n    results: 50\n    enabled: true\n`;
  }
  block+=BLOCK_END+'\n';
  writeFileSync(P.portals, text+block,'utf-8');
}
async function importResume(P, uid, resume){
  const buf=Buffer.from(resume.base64,'base64'); const name=(resume.name||'').toLowerCase();
  if(existsSync(P.cv)) writeFileSync(P.cv+'.bak', readFileSync(P.cv));
  if(name.endsWith('.md')||name.endsWith('.txt')||(resume.mime||'').startsWith('text/')){ writeFileSync(P.cv, buf.toString('utf-8'),'utf-8'); if(USE_SUPA){ try{ await supa.uploadResume(uid, readFileSync(P.cv)); }catch(e){} } return { imported:'text' }; }
  if(!process.env.GEMINI_API_KEY) return { imported:false, note:'PDF résumé needs GEMINI_API_KEY to convert — or upload .md/.txt.' };
  const { GoogleGenerativeAI }=await import('@google/generative-ai');
  const model=new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model:process.env.GEMINI_MODEL||'gemini-2.0-flash' });
  const r=await model.generateContent([{ text:'Convert this resume to clean GitHub-flavored Markdown. Keep ALL facts exactly. Start with the name as H1, then a contact line. Markdown only.' },{ inlineData:{ data:resume.base64, mimeType:resume.mime||'application/pdf' } }]);
  writeFileSync(P.cv, r.response.text().trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim(),'utf-8');
  if(USE_SUPA){ try{ await supa.uploadResume(uid, readFileSync(P.cv)); }catch(e){} }
  return { imported:'converted' };
}
async function retarget(P, uid, body){
  const roles=(body.roles||'').split(/[,\n]/).map(s=>s.trim()).filter(Boolean).slice(0,10);
  if(!roles.length && !body.resume) return { ok:false, error:'Provide roles and/or a résumé.' };
  let resumeNote=null;
  if(body.resume){ try{ const r=await importResume(P, uid, body.resume); resumeNote=r.note||('résumé '+(r.imported||'updated')); }catch(e){ resumeNote='résumé import failed: '+e.message; } }
  if(roles.length){ addPositiveKeywords(P,roles); writeSearchBlock(P,roles); }
  const search=roles.length?await liveSearchTitles(P, uid, roles, body.window):{ found:0,added:0,errors:[] };
  return { ok:true, roles, resumeNote, ...search };
}

/* ── child-process actions (per user) ── */
function spawnJSON(args, env){ return new Promise(res=>{ const c=spawn('node',args,{cwd:process.cwd(),env}); let out='',err=''; c.stdout.on('data',d=>out+=d); c.stderr.on('data',d=>err+=d); c.on('close',()=>{ try{ res(JSON.parse(out.trim().split('\n').pop())); }catch{ res({ ok:false, error:(err||out||'failed').slice(-400) }); } }); }); }
async function ensureResumeLocal(P, uid){
  if(!USE_SUPA) return;
  try{ const buf=await supa.downloadResume(uid); if(buf) writeFileSync(P.cv, buf); }catch(e){}
}
function runScan(uid){ return new Promise(res=>{ const c=spawn('node',['scan.mjs'],{cwd:process.cwd(),env:userEnv(uid)}); let out=''; c.stdout.on('data',d=>out+=d); c.stderr.on('data',d=>out+=d); c.on('close',code=>res({ ok:code===0, code, output:out.slice(-4000) })); }); }
function runTailor(uid,url){ return url?spawnJSON(['tailor.mjs','--url',url], userEnv(uid)):Promise.resolve({ ok:false, error:'missing url' }); }
function startPrefill(uid,url,resumeRel){ if(!url) return { ok:false, error:'missing url' }; const P=userPaths(uid); const args=['prefill.mjs','--url',url]; if(resumeRel) args.push('--resume', `${P.dir}/${resumeRel}`); const c=spawn('node',args,{cwd:process.cwd(),detached:true,stdio:'ignore',env:userEnv(uid)}); c.unref(); return { ok:true, message:'Opening & pre-filling. Review and submit yourself — nothing is auto-submitted.' }; }
function startPrefillBatch(uid,jobs){ if(!Array.isArray(jobs)||!jobs.length) return { ok:false, error:'no jobs selected' }; const P=userPaths(uid); const list=jobs.slice(0,25).map(j=>({ url:j.url, resume:j.resume?`${P.dir}/${j.resume}`:null })); const file=`${P.dir}/.prefill-batch.json`; writeFileSync(file, JSON.stringify(list),'utf-8'); const c=spawn('node',['prefill.mjs','--batch',file],{cwd:process.cwd(),detached:true,stdio:'ignore',env:userEnv(uid)}); c.unref(); return { ok:true, count:list.length, message:`Opening ${list.length} tab(s) and pre-filling each. Review and submit yourself.` }; }

/* ── http plumbing ── */
const MIME={ '.pdf':'application/pdf','.html':'text/html; charset=utf-8','.md':'text/markdown; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8' };
function send(res,code,body,type='application/json'){ res.writeHead(code,{ 'Content-Type':type,'Cache-Control':'no-store' }); res.end(typeof body==='string'?body:JSON.stringify(body)); }
function readBody(req){ return new Promise(r=>{ let b=''; req.on('data',c=>{ b+=c; if(b.length>20e6) req.destroy(); }); req.on('end',()=>{ try{ r(b?JSON.parse(b):{}); }catch{ r({}); } }); }); }
function currentUser(req){ const tok=auth.parseCookie(req.headers.cookie)[auth.SESSION_COOKIE]; return auth.getSessionUser(tok); }
function serveUserFile(res, P, pathname){
  const rel=normalize(decodeURIComponent(pathname.replace(/^\/files\//,'')));
  if(rel.includes('..')) return send(res,403,'forbidden','text/plain');
  const abs=resolve(P.dir, rel);
  if(!abs.startsWith(resolve(P.dir)) || !existsSync(abs) || !statSync(abs).isFile()) return send(res,404,'not found','text/plain');
  res.writeHead(200,{ 'Content-Type':MIME[extname(abs).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store' });
  res.end(readFileSync(abs));
}

const server=http.createServer(async (req,res)=>{
  try{
    const url=new URL(req.url, `http://localhost:${PORT}`); const p=url.pathname;
    const user=currentUser(req);

    // public
    if(req.method==='GET' && p==='/healthz') return send(res,200,{ ok:true, store: USE_SUPA?'supabase':'files' });
    if(req.method==='GET' && p==='/login'){ return send(res,200, existsSync(LOGIN_HTML)?readFileSync(LOGIN_HTML,'utf-8'):'login missing','text/html; charset=utf-8'); }
    if(req.method==='POST' && p==='/api/signup'){
      const b=await readBody(req); const r=auth.createUser(b);
      if(r.error) return send(res,400,{ ok:false, error:r.error });
      seedUser(r.user.id,{ name:b.name, email:b.email });
      const tok=auth.createSession(r.user.id);
      res.setHeader('Set-Cookie', auth.sessionCookie(tok)); return send(res,200,{ ok:true });
    }
    if(req.method==='POST' && p==='/api/login'){
      const b=await readBody(req); const u=auth.verifyUser(b.email,b.password);
      if(!u) return send(res,401,{ ok:false, error:'Invalid email or password' });
      seedUser(u.id,{ name:u.name, email:u.email });
      const tok=auth.createSession(u.id);
      res.setHeader('Set-Cookie', auth.sessionCookie(tok)); return send(res,200,{ ok:true });
    }
    if(req.method==='POST' && p==='/api/logout'){ const tok=auth.parseCookie(req.headers.cookie)[auth.SESSION_COOKIE]; auth.destroySession(tok); res.setHeader('Set-Cookie', auth.clearCookie()); return send(res,200,{ ok:true }); }

    if(req.method==='GET' && (p==='/'||p==='/index.html')){
      if(!user){ res.writeHead(302,{ Location:'/login' }); return res.end(); }
      return send(res,200, readFileSync(APP_HTML,'utf-8'),'text/html; charset=utf-8');
    }

    // everything below requires auth
    if(!user) return send(res,401,{ ok:false, error:'not authenticated' });
    const P=userPaths(user.id);

    if(req.method==='GET' && p==='/api/me') return send(res,200,{ ok:true, name:user.name, email:user.email });
    if(req.method==='GET' && p==='/api/profile') return send(res,200,{ ok:true, profile:await readProfile(P, user.id) });
    if(req.method==='POST' && p==='/api/profile'){ const b=await readBody(req); return send(res,200,{ ok:true, profile:await writeProfile(P, user.id, b) }); }
    if(req.method==='GET' && p==='/api/resume'){
      await ensureResumeLocal(P, user.id);
      let text='', has=false;
      try{ text=readFileSync(P.cv,'utf-8'); has=text.trim().length>0 && !/_Upload your r/.test(text); }catch{}
      return send(res,200,{ ok:true, has, preview:text.slice(0,1200), url:'/files/cv.md' });
    }
    if(req.method==='POST' && p==='/api/resume'){
      const b=await readBody(req); if(!b.resume) return send(res,400,{ ok:false, error:'no file' });
      try{ const r=await importResume(P, user.id, b.resume); return send(res,200,{ ok:true, ...r }); }
      catch(e){ return send(res,400,{ ok:false, error:e.message }); }
    }
    if(req.method==='GET' && p.startsWith('/files/')){ if(p.endsWith('/cv.md')) await ensureResumeLocal(P, user.id); return serveUserFile(res,P,p); }
    if(req.method==='GET' && p==='/api/jobs'){
      const jobs=await loadJobs(P, user.id);
      const counts={ total:jobs.length, AUTO:jobs.filter(j=>j.queue==='AUTO').length, MANUAL:jobs.filter(j=>j.queue==='MANUAL').length, REVIEW:jobs.filter(j=>j.queue==='REVIEW').length, applied:jobs.filter(j=>j.applied).length };
      const sources=[...new Set(jobs.map(j=>j.source).filter(Boolean))].sort();
      return send(res,200,{ jobs, counts, sources, generated:new Date().toISOString() });
    }
    if(req.method==='POST' && p==='/api/search'){ const b=await readBody(req); const titles=String(b.title||'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean); const r=await liveSearchTitles(P, user.id, titles.length?titles:[b.title], b.window); return send(res,200,{ ok:true, title:b.title, ...r }); }
    if(req.method==='POST' && p==='/api/scan'){ const r=await runScan(user.id); if(USE_SUPA){ try{ await syncFileToSupabase(P, user.id); }catch(e){ r.syncError=e.message; } } return send(res,200, r); }
    if(req.method==='POST' && p==='/api/tailor'){
      const b=await readBody(req); await ensureResumeLocal(P, user.id); const r=await runTailor(user.id,b.url);
      if(r.ok){ await setAppPatch(P, user.id, b.url, { company:b.company, title:b.title, tailoredResume:r.pdf||r.html, tailoredAt:new Date().toISOString() });
        r.htmlUrl = relFile(P, r.html); r.pdfUrl = relFile(P, r.pdf); }
      return send(res, r.ok?200:400, r);
    }
    if(req.method==='POST' && p==='/api/prefill'){ const b=await readBody(req); await ensureResumeLocal(P, user.id); return send(res,200, startPrefill(user.id,b.url,b.resume)); }
    if(req.method==='POST' && p==='/api/prefill-batch'){ const b=await readBody(req); await ensureResumeLocal(P, user.id); return send(res,200, startPrefillBatch(user.id,b.jobs)); }
    if(req.method==='POST' && p==='/api/apply'){
      const b=await readBody(req); const apps=await loadApps(P, user.id); const prev=apps[b.url]||{};
      const appliedAt=new Date().toISOString();
      const resumeUsed=(b.resume?`${P.dir}/${b.resume}`:prev.tailoredResume)||null;
      await setAppPatch(P, user.id, b.url, { company:b.company||prev.company, title:b.title||prev.title, applied:true, appliedAt, resumeUsed });
      return send(res,200,{ ok:true, applied:true, appliedAt, resumeUsed:relFile(P,resumeUsed) });
    }
    if(req.method==='POST' && p==='/api/unapply'){ const b=await readBody(req); await setAppPatch(P, user.id, b.url, { applied:false, appliedAt:null }); return send(res,200,{ ok:true }); }
    if(req.method==='POST' && p==='/api/retarget'){ const b=await readBody(req); return send(res,200, await retarget(P, user.id, b)); }
    return send(res,404,{ error:'not found' });
  }catch(err){ console.error('[request error]', req.method, req.url, '->', err.message); return send(res,500,{ error:err.message }); }
});
server.listen(PORT, ()=>console.log(`\n  career-ops (multi-user) → http://localhost:${PORT}\n  data store: ${USE_SUPA ? 'Supabase' : 'local files'}\n  (Ctrl+C to stop)\n`));
