/**
 * migrate-to-supabase.mjs — one-time import of existing local file data
 * (per-user history, applications, profile) into Supabase.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE in .env and the schema applied.
 *   node migrate-to-supabase.mjs
 */
import 'dotenv/config';
import { readFileSync, existsSync, readdirSync } from 'fs';
import yaml from 'js-yaml';
import * as supa from './supabase.mjs';
import { userPaths } from './storage.mjs';

if(!supa.enabled){ console.error('Set SUPABASE_URL + SUPABASE_SERVICE_ROLE in .env first.'); process.exit(1); }

const uids = (()=>{ try { return readdirSync('data/users',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name); } catch { return []; } })();
for(const uid of uids){
  const P=userPaths(uid);
  // profile
  try{ if(existsSync(P.profile)){ const y=yaml.load(readFileSync(P.profile,'utf-8'))||{}; const c=y.candidate||{};
    await supa.setProfile(uid,{ full_name:c.full_name||'', email:c.email||'', phone:c.phone||'', location:c.location||'', linkedin:c.linkedin||'', github:c.github||'', portfolio_url:c.portfolio_url||'', work_authorization:(y.location&&y.location.visa_status)||'' }); } }catch(e){ console.error(uid,'profile:',e.message); }
  // jobs (group by date)
  try{ if(existsSync(P.history)){
    const seen=new Set(); const byDate={};
    for(const line of readFileSync(P.history,'utf-8').split('\n').slice(1)){
      if(!line.trim()) continue; const p=line.split('\t'); const url=p[0]; if(!url||seen.has(url)) continue; seen.add(url);
      const d=p[1]||'1970-01-01'; (byDate[d]=byDate[d]||[]).push({ url, source:p[2], title:p[3], company:p[4], location:p[6]||'' });
    }
    for(const d of Object.keys(byDate)) await supa.addRows(uid, byDate[d], d);
  } }catch(e){ console.error(uid,'jobs:',e.message); }
  // applications
  try{ if(existsSync(P.applications)){ const a=JSON.parse(readFileSync(P.applications,'utf-8')); for(const url of Object.keys(a)) await supa.setApp(uid,url,a[url]); } }catch(e){ console.error(uid,'apps:',e.message); }
  console.log('migrated', uid);
}
console.log('Done. Restart the server — it will read from Supabase.');
