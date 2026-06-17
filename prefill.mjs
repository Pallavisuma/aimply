#!/usr/bin/env node

/**
 * prefill.mjs — open application form(s) and pre-fill. NEVER submits.
 *
 * Single:  node prefill.mjs --url <applyUrl> [--resume file.pdf]
 * Batch:   node prefill.mjs --batch jobs.json   ([{url,resume}, ...])
 *
 * Fills by matching each input to its visible label / placeholder / aria
 * text (and nearby text), searches inside iframes, and sets values the
 * React-safe way so controlled inputs (Workday, Greenhouse, Adobe, etc.)
 * actually register the change. Country/State dropdowns are handled too.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { chromium } from 'playwright';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MANUAL_HOSTS = ['linkedin.com','indeed.com','glassdoor.com','ziprecruiter.com'];
const arg = (n,d=null)=>{ const i=process.argv.indexOf('--'+n); return i!==-1?process.argv[i+1]:d; };
const hostOf = u => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };

function loadProfile(){
  const PROFILE_PATH = process.env.CAREER_OPS_PROFILE || 'config/profile.yml';
  const p = existsSync(PROFILE_PATH) ? yaml.load(readFileSync(PROFILE_PATH,'utf-8')) : {};
  const c = (p && p.candidate) || {};
  const loc = (p && p.location) || {};
  const full = c.full_name || '';
  const [first,...rest] = full.split(' ');
  return {
    first, last: rest.join(' '), full,
    email:c.email||'', phone:c.phone||'',
    linkedin:c.linkedin||'', github:c.github||'', website:c.portfolio_url||'',
    city: loc.city || '', state: c.location || loc.city || '', country:'United States',
  };
}

// Runs INSIDE the page/frame. Matches inputs by label-ish text and fills.
function pageFiller(prof){
  const norm = s => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const setNative = (el,val)=>{
    const proto = el.tagName==='TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el,val);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
  };
  const labelText = el => {
    let t='';
    if(el.id){ const l=document.querySelector('label[for="'+(window.CSS&&CSS.escape?CSS.escape(el.id):el.id)+'"]'); if(l) t+=' '+l.innerText; }
    t+=' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('placeholder')||'')+' '+(el.name||'')+' '+(el.id||'')+' '+(el.getAttribute('data-automation-id')||'');
    let p=el.parentElement,hops=0;
    while(p&&hops<4){ const lab=p.querySelector('label'); if(lab) t+=' '+lab.innerText; hops++; p=p.parentElement; }
    return norm(t);
  };
  const visible = el => el.offsetParent!==null && !el.disabled && !el.readOnly;
  const all=[...document.querySelectorAll('input,textarea,select')].filter(visible)
    .filter(el=>!['hidden','file','submit','button','checkbox','radio','search','password'].includes(el.type));
  const used=new Set();
  const fields=[
    { keys:['first name','firstname','given name','first'], v:prof.first },
    { keys:['last name','lastname','family name','surname','last'], v:prof.last },
    { keys:['full name','your name','legal name','name'], v:prof.full, only: !prof.first },
    { keys:['email','e-mail'], v:prof.email },
    { keys:['phone','mobile','telephone'], v:prof.phone },
    { keys:['linkedin'], v:prof.linkedin },
    { keys:['github'], v:prof.github },
    { keys:['portfolio','website','personal site','url'], v:prof.website },
    { keys:['city'], v:prof.city },
    { keys:['state','province'], v:prof.state, select:true },
    { keys:['country'], v:prof.country, select:true },
  ];
  const filled=[];
  for(const f of fields){
    if(!f.v || f.only===false) continue;
    for(const el of all){
      if(used.has(el)) continue;
      const lt=labelText(el);
      if(!f.keys.some(k=>lt.includes(k))) continue;
      const tag=el.tagName.toLowerCase();
      try{
        if(tag==='select'){
          const opt=[...el.options].find(o=>norm(o.text).includes(norm(f.v))||norm(o.value).includes(norm(f.v)));
          if(!opt) continue;
          el.value=opt.value; el.dispatchEvent(new Event('change',{bubbles:true}));
        } else { setNative(el,f.v); }
        used.add(el); filled.push(f.keys[0]); break;
      }catch(e){}
    }
  }
  return filled;
}

async function fillScopeAllFrames(page, prof){
  let filled=[];
  for(const frame of page.frames()){
    try{ const r=await frame.evaluate(pageFiller, prof); if(r&&r.length) filled=filled.concat(r); }catch(e){}
  }
  return [...new Set(filled)];
}
async function attachResume(page, resumePath){
  if(!resumePath) return false;
  for(const frame of page.frames()){
    for(const sel of ['input[type="file"]','input[name*="resume" i]','input[id*="resume" i]','input[name*="cv" i]']){
      try{ const el=frame.locator(sel).first(); if(await el.count()){ await el.setInputFiles(resumePath); return true; } }catch(e){}
    }
  }
  return false;
}

// In-page: tag empty open-ended fields and return their question labels.
function tagQuestions(){
  const norm=s=>(s||'').replace(/\s+/g,' ').trim();
  const qtext=el=>{
    let t='';
    if(el.id){ const l=document.querySelector('label[for="'+(window.CSS&&CSS.escape?CSS.escape(el.id):el.id)+'"]'); if(l) t+=' '+l.innerText; }
    t+=' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('placeholder')||'');
    let p=el.parentElement,hops=0;
    while(p&&hops<4){ const lab=p.querySelector('label,legend,h2,h3,h4'); if(lab) t+=' '+lab.innerText; const ps=el.previousElementSibling; hops++; p=p.parentElement; }
    if(el.previousElementSibling) t+=' '+el.previousElementSibling.innerText;
    return norm(t).slice(0,320);
  };
  const els=[...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(el=>el.offsetParent!==null && !el.disabled);
  const out=[]; let i=0;
  for(const el of els){
    const val = el.tagName==='TEXTAREA' ? el.value : el.innerText;
    if(val && val.trim().length>2) continue;          // skip already-filled
    el.setAttribute('data-co-q', String(i));
    out.push({ i, label: qtext(el) || 'Additional information' });
    i++;
  }
  return out;
}
// In-page: write drafted answers back into the tagged fields.
function fillAnswers(map){
  const setNative=(el,val)=>{ const proto=window.HTMLTextAreaElement.prototype; const setter=Object.getOwnPropertyDescriptor(proto,'value').set; setter.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new Event('blur',{bubbles:true})); };
  let n=0;
  for(const k of Object.keys(map)){
    const el=document.querySelector('[data-co-q="'+k+'"]'); const ans=map[k];
    if(!el||!ans) continue;
    if(el.tagName==='TEXTAREA') setNative(el,ans);
    else { el.innerText=ans; el.dispatchEvent(new Event('input',{bubbles:true})); }
    n++;
  }
  return n;
}

async function draftAnswer(model, question, cv, jd){
  const prompt=`You are helping a job candidate fill an application. Write a concise, professional answer (3-6 sentences, first person) to the question below.
STRICT: use ONLY facts from the candidate's resume — do NOT invent employers, numbers, or experience. If the resume lacks specifics, answer in general truthful terms. Plain text only.

QUESTION: ${question}

JOB CONTEXT (may be partial):
${(jd||'').slice(0,2500)}

RESUME:
${cv.slice(0,4000)}`;
  const r=await model.generateContent(prompt);
  return r.response.text().trim().replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim();
}

async function answerOpenEnded(page, model, cv){
  if(!model) return [];
  // collect JD-ish context from the page
  let jd=''; try{ jd=await page.evaluate(()=>document.body.innerText.slice(0,6000)); }catch(e){}
  let questions=[]; try{ questions=await page.evaluate(tagQuestions); }catch(e){ return []; }
  questions=questions.slice(0,6);                      // cap API calls
  const map={}; const done=[];
  for(const q of questions){
    try{ const a=await draftAnswer(model, q.label, cv, jd); if(a){ map[q.i]=a; done.push(q.label.slice(0,60)); } }catch(e){}
  }
  if(Object.keys(map).length){ try{ await page.evaluate(fillAnswers, map); }catch(e){} }
  return done;
}

async function revealForm(page){
  const names=[/^application$/i,/^apply now$/i,/^apply for this job$/i,/^start application$/i,/^i'?m interested$/i,/^apply$/i];
  for(const re of names){
    for(const role of ['tab','link','button']){
      try{ const el=page.getByRole(role,{name:re}).first();
        if(await el.count() && await el.isVisible()){ await el.click({timeout:2500}).catch(()=>{}); await page.waitForTimeout(1500); return true; } }catch(e){}
    }
  }
  return false;
}

async function handleJob(opener, job, prof, model, cv){
  const manual = MANUAL_HOSTS.some(h=>hostOf(job.url).includes(h));
  const page = await opener.newPage();
  try{
    await page.goto(job.url,{ waitUntil:'domcontentloaded', timeout:45000 }).catch(()=>{});
    await page.waitForLoadState('networkidle',{ timeout:9000 }).catch(()=>{});
    await page.waitForTimeout(2000);
    if(manual) return { url:job.url, manual:true, filled:[] };
    await revealForm(page);                 // click "Application"/"Apply" to show the form (Ashby etc.)
    let filled = await fillScopeAllFrames(page, prof);
    if(filled.length===0){ await page.waitForTimeout(1500); filled = await fillScopeAllFrames(page, prof); }
    const resumePath = job.resume && existsSync(job.resume) ? resolve(job.resume) : null;
    const resumeOk = await attachResume(page, resumePath);
    if(resumeOk) filled.push('resume');
    const answered = await answerOpenEnded(page, model, cv);
    if(answered.length) filled.push(answered.length+' question(s) drafted');
    return { url:job.url, manual:false, filled };
  }catch(e){ return { url:job.url, error:e.message }; }
}

// Prefer the user's already-running Chrome (tabs open next to theirs).
// Start it with:  npm run chrome   (launches Chrome with --remote-debugging-port=9222)
async function getOpener(){
  const cdp = process.env.CHROME_CDP || 'http://127.0.0.1:9222';
  try{
    const browser = await chromium.connectOverCDP(cdp, { timeout: 1800 });
    const ctx = browser.contexts()[0] || await browser.newContext();
    return { browser, opener: ctx, connected: true };
  }catch(e){
    let browser;
    try{ browser = await chromium.launch({ headless:false, channel: process.env.PREFILL_CHANNEL || 'chrome' }); }
    catch(_){ browser = await chromium.launch({ headless:false }); }
    return { browser, opener: browser, connected: false };
  }
}

async function main(){
  const prof = loadProfile();
  const batchFile = arg('batch');
  let jobs;
  if(batchFile){ jobs=JSON.parse(readFileSync(batchFile,'utf-8')); }
  else { const url=arg('url'); if(!url){ console.error('Missing --url or --batch'); process.exit(1); } jobs=[{ url, resume:arg('resume') }]; }

  let model=null;
  if(process.env.GEMINI_API_KEY){
    try{ const genAI=new GoogleGenerativeAI(process.env.GEMINI_API_KEY); model=genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' }); }catch(e){}
  }
  const CV_PATH = process.env.CAREER_OPS_CV || 'cv.md';
  const cv = existsSync(CV_PATH) ? readFileSync(CV_PATH,'utf-8') : '';
  const { browser, opener, connected } = await getOpener();
  const results=[];
  for(const job of jobs) results.push(await handleJob(opener, job, prof, model, cv));
  console.log(JSON.stringify({ ok:true, connected, tabs:results.length, results,
    message: connected
      ? 'Opened as tabs in your Chrome. REVIEW each tab and click Submit yourself — nothing is auto-submitted.'
      : 'Chrome debug port not found, so I opened a Chrome window instead. Tip: run "npm run chrome" first to open tabs in your own browser. Nothing is auto-submitted.' }));
  if(connected){
    // Leave the tabs in the user's browser; just drop our CDP connection.
    process.exit(0);
  } else {
    await new Promise(res=>browser.on('disconnected',res));
  }
}
main().catch(e=>{ console.error(JSON.stringify({ ok:false, error:e.message })); process.exit(1); });
