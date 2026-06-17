/**
 * providers/jooble.mjs — Jooble aggregator (broad; catches many boards incl.
 * Indeed/LinkedIn/Built In cross-posts). Env: JOOBLE_API_KEY (free at jooble.org/api/about)
 * Entry: { provider: jooble, query, where?, results? }
 */
const HOST='jooble.org'; const TIMEOUT_MS=12000;
export const id='jooble';
export function detect(e){ return e && e.provider==='jooble'; }
export async function fetch(entry){
  const key=process.env.JOOBLE_API_KEY;
  if(!key) throw new Error('JOOBLE_API_KEY not set — free at jooble.org/api/about');
  if(!entry.query) throw new Error('jooble entry missing "query"');
  const url=`https://${HOST}/api/${key}`;
  const body=JSON.stringify({ keywords:entry.query, location:entry.where||'United States' });
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  let json; try{ const r=await globalThis.fetch(url,{ method:'POST', signal:ctl.signal, headers:{ 'Content-Type':'application/json', Accept:'application/json' }, body }); if(!r.ok) throw new Error(`HTTP ${r.status}`); json=await r.json(); } finally { clearTimeout(t); }
  const jobs=Array.isArray(json?.jobs)?json.jobs:[];
  return jobs.map(j=>({ title:j.title||'', url:j.link||'', company:j.company||'Unknown', location:j.location||'', posted:j.updated||'' })).filter(x=>x.url&&x.title).slice(0, entry.results||50);
}
