/**
 * providers/adzuna.mjs — free second market-wide search source.
 *
 * Adzuna syndicates many boards/agencies and provides salary data.
 * One portals entry = one title+country search returning MANY companies.
 *
 * Env: ADZUNA_APP_ID, ADZUNA_APP_KEY  (free at developer.adzuna.com)
 *
 * Entry fields (in portals.yml):
 *   provider: adzuna
 *   query:        "AI Engineer"   (required)
 *   country:      us              (default: us — Adzuna country code)
 *   max_days_old: 7               (default: 7)
 *   results:      50              (default: 50; capped per API page at 50)
 *   where:        "San Francisco" (optional location filter)
 *
 * Returns: Job[] = { title, url, company, location }
 */

const HOST = 'api.adzuna.com';
const TIMEOUT_MS = 12_000;

export const id = 'adzuna';

export function detect(entry) {
  return entry && entry.provider === 'adzuna';
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').trim();
}

export async function fetch(entry) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error('ADZUNA_APP_ID / ADZUNA_APP_KEY not set — see .env.example / README');
  }
  if (!entry.query) {
    throw new Error('adzuna entry missing "query"');
  }

  const country = (entry.country || 'us').toLowerCase();
  const perPage = Math.min(entry.results || 50, 50);
  const pages = Math.min(entry.pages || 3, 10);          // paginate for volume

  const out = [];
  for (let page = 1; page <= pages; page++) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: String(perPage),
      what: entry.query,
      max_days_old: String(entry.max_days_old || 30),
    });
    if (entry.where) params.set('where', entry.where);
    const url = `https://${HOST}/v1/api/jobs/${country}/search/${page}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let json;
    try {
      const res = await globalThis.fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!res.ok) {
        if (page > 1) break;                              // tolerate end-of-results
        let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch {}
        throw new Error(`HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
      }
      json = await res.json();
    } finally { clearTimeout(timer); }

    const results = Array.isArray(json?.results) ? json.results : [];
    for (const j of results) out.push({
      title: stripHtml(j.title),
      url: j.redirect_url || '',
      company: j.company?.display_name || 'Unknown',
      location: j.location?.display_name || '',
      posted: j.created || '',
    });
    if (results.length < perPage) break;                  // last page
  }
  return out.filter(job => job.url && job.title);
}
