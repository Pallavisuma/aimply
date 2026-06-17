/**
 * providers/themuse.mjs — The Muse (companies + startups). Keyless (optional MUSE_API_KEY).
 * Entry: { provider: themuse, query, where?, pages? }
 * Maps the query to a Muse category, returns Job[] {title,url,company,location}
 */
const HOST='www.themuse.com'; const TIMEOUT_MS=12000;
export const id='themuse';
export function detect(e){ return e && e.provider==='themuse'; }
function category(q){
  const l=(q||'').toLowerCase();
  if(/(data scien|machine learning|\bml\b|\bai\b|nlp|research)/.test(l)) return 'Data Science';
  if(/(devops|sre|platform|infrastructure|mlops)/.test(l)) return 'IT';
  if(/(product manager|\bpm\b)/.test(l)) return 'Product Management';
  return 'Software Engineering';
}
export async function fetch(entry){
  if(!entry.query) throw new Error('themuse entry missing "query"');
  const pages=Math.min(entry.pages||3,5); const out=[];
  for(let pg=1; pg<=pages; pg++){
    const params=new URLSearchParams({ page:String(pg), category:category(entry.query) });
    if(entry.where) params.set('location', entry.where);
    if(process.env.MUSE_API_KEY) params.set('api_key', process.env.MUSE_API_KEY);
    const url=`https://${HOST}/api/public/jobs?${params}`;
    const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
    let json; try{ const r=await globalThis.fetch(url,{ signal:ctl.signal, headers:{ Accept:'application/json' } }); if(!r.ok) throw new Error(`HTTP ${r.status}`); json=await r.json(); } finally { clearTimeout(t); }
    for(const j of (json?.results||[])) out.push({
      title:j.name||'', url:j.refs?.landing_page||'', company:j.company?.name||'Unknown',
      location:(j.locations||[]).map(l=>l.name).join(', ')||'',
      posted:j.publication_date||'',
    });
  }
  return out.filter(x=>x.url&&x.title);
}
