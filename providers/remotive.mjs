/**
 * providers/remotive.mjs — Remotive (remote jobs aggregator). Keyless.
 * Entry: { provider: remotive, query, results? }
 * Returns Job[] {title,url,company,location}
 */
const HOST='remotive.com'; const TIMEOUT_MS=12000;
export const id='remotive';
export function detect(e){ return e && e.provider==='remotive'; }
export async function fetch(entry){
  if(!entry.query) throw new Error('remotive entry missing "query"');
  const params=new URLSearchParams({ search:entry.query, limit:String(entry.results||50) });
  const url=`https://${HOST}/api/remote-jobs?${params}`;
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  let json; try{ const r=await globalThis.fetch(url,{ signal:ctl.signal, headers:{ Accept:'application/json' } }); if(!r.ok) throw new Error(`HTTP ${r.status}`); json=await r.json(); } finally { clearTimeout(t); }
  const jobs=Array.isArray(json?.jobs)?json.jobs:[];
  return jobs.map(j=>({ title:j.title||'', url:j.url||'', company:j.company_name||'Unknown', location:(j.candidate_required_location||'Remote'), posted:j.publication_date||'' })).filter(x=>x.url&&x.title);
}
