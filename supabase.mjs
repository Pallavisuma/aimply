/**
 * supabase.mjs — Supabase data layer (used when SUPABASE_URL + SERVICE_ROLE set).
 * Mirrors the file store: jobs, applications, profiles. Server-side trusted client.
 */
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;
const isReal = v => !!v && !/^(your_|replace|dummy|paste|xxx|<)/i.test(v.trim());
export const enabled = isReal(url) && isReal(key);

let sb = null;
async function client(){
  if(sb) return sb;
  if(typeof globalThis.WebSocket === 'undefined'){
    try { globalThis.WebSocket = (await import('ws')).default; } catch {}
  }
  const { createClient } = await import('@supabase/supabase-js');
  sb = createClient(url, key, { auth:{ persistSession:false } });
  return sb;
}

export async function getRows(uid){
  const c = await client();
  const { data, error } = await c.from('jobs').select('url,first_seen,source,title,company,location,posted').eq('uid', uid);
  if(error) throw new Error('supabase getRows: '+error.message);
  return (data||[]).map(r=>({ url:r.url, first_seen:r.first_seen, portal:r.source, title:r.title, company:r.company, location:r.location, posted:r.posted||'' }));
}
export async function getSeenUrls(uid){
  const c = await client();
  const { data, error } = await c.from('jobs').select('url').eq('uid', uid);
  if(error) throw new Error('supabase getSeenUrls: '+error.message);
  return new Set((data||[]).map(r=>r.url));
}
export async function addRows(uid, jobs, date){
  if(!jobs.length) return;
  const c = await client();
  const recs = jobs.map(o=>({ uid, url:o.url, first_seen:date, source:o.source, title:o.title, company:o.company, location:o.location||'', posted:o.posted||null }));
  const { error } = await c.from('jobs').upsert(recs, { onConflict:'uid,url', ignoreDuplicates:true });
  if(error) throw new Error('supabase addRows: '+error.message);
}
export async function getApps(uid){
  const c = await client();
  const { data, error } = await c.from('applications').select('*').eq('uid', uid);
  if(error) throw new Error('supabase getApps: '+error.message);
  const m={};
  for(const r of (data||[])) m[r.url]={ company:r.company, title:r.title, tailoredResume:r.tailored_resume, tailoredAt:r.tailored_at, applied:r.applied, appliedAt:r.applied_at, resumeUsed:r.resume_used };
  return m;
}
export async function setApp(uid, url, patch){
  const c = await client();
  const rec = { uid, url };
  if('company' in patch) rec.company=patch.company;
  if('title' in patch) rec.title=patch.title;
  if('tailoredResume' in patch) rec.tailored_resume=patch.tailoredResume;
  if('tailoredAt' in patch) rec.tailored_at=patch.tailoredAt;
  if('applied' in patch) rec.applied=patch.applied;
  if('appliedAt' in patch) rec.applied_at=patch.appliedAt;
  if('resumeUsed' in patch) rec.resume_used=patch.resumeUsed;
  const { error } = await c.from('applications').upsert(rec, { onConflict:'uid,url' });
  if(error) throw new Error('supabase setApp: '+error.message);
}
const RESUME_BUCKET = process.env.SUPABASE_RESUME_BUCKET || 'resumes';
export async function uploadResume(uid, buf, contentType='text/markdown'){
  const c = await client();
  const { error } = await c.storage.from(RESUME_BUCKET).upload(`${uid}/cv.md`, buf, { contentType, upsert:true });
  if(error) throw new Error('storage upload: '+error.message);
}
export async function downloadResume(uid){
  const c = await client();
  const { data, error } = await c.storage.from(RESUME_BUCKET).download(`${uid}/cv.md`);
  if(error) return null;
  return Buffer.from(await data.arrayBuffer());
}
export async function getProfile(uid){
  const c = await client();
  const { data, error } = await c.from('profiles').select('*').eq('uid', uid).maybeSingle();
  if(error) throw new Error('supabase getProfile: '+error.message);
  const r = data||{};
  return { full_name:r.full_name||'', email:r.email||'', phone:r.phone||'', location:r.location||'', linkedin:r.linkedin||'', github:r.github||'', portfolio_url:r.portfolio_url||'', work_authorization:r.work_authorization||'' };
}
export async function setProfile(uid, f){
  const c = await client();
  const rec = { uid, updated_at:new Date().toISOString() };
  for(const k of ['full_name','email','phone','location','linkedin','github','portfolio_url','work_authorization']) if(f[k]!==undefined) rec[k]=f[k];
  const { error } = await c.from('profiles').upsert(rec, { onConflict:'uid' });
  if(error) throw new Error('supabase setProfile: '+error.message);
  return getProfile(uid);
}
