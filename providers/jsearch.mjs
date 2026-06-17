/**
 * providers/jsearch.mjs — market-wide search provider (Google for Jobs).
 *
 * Inverts the company-centric model: one portals entry = one
 * title+country search returning MANY companies. JSearch aggregates
 * Google for Jobs, so it catches LinkedIn/Indeed cross-posted roles;
 * its `job_apply_link` is usually the company's own ATS URL.
 *
 * Env: JSEARCH_API_KEY  (a RapidAPI key for the JSearch API)
 *
 * Entry fields (in portals.yml):
 *   provider: jsearch
 *   query:        "AI Engineer"        (required)
 *   country:      us                   (default: us)
 *   date_posted:  all|today|3days|week|month  (default: week)
 *   pages:        1                     (default: 1; each page ~10 results)
 *   via:          linkedin|indeed       (optional — narrows to that source)
 *
 * Returns: Job[] = { title, url, company, location }
 */

const HOST = 'jsearch.p.rapidapi.com';
const TIMEOUT_MS = 22_000;

export const id = 'jsearch';

export function detect(entry) {
  return entry && entry.provider === 'jsearch';
}

function buildLocation(j) {
  return [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ');
}

export async function fetch(entry) {
  const key = process.env.JSEARCH_API_KEY;
  if (!key) {
    throw new Error('JSEARCH_API_KEY not set — see .env.example / README');
  }
  if (!entry.query) {
    throw new Error('jsearch entry missing "query"');
  }

  let query = entry.query;
  if (entry.via === 'linkedin') query += ' linkedin';
  else if (entry.via === 'indeed') query += ' indeed';

  const params = new URLSearchParams({
    query: `${query} in ${entry.country || 'us'}`,
    page: '1',
    num_pages: String(entry.pages || 1),
    date_posted: entry.date_posted || 'week',
    country: (entry.country || 'us').toLowerCase(),
  });

  // SSRF-safe: host is pinned, https only.
  const url = `https://${HOST}/search?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let json;
  try {
    const res = await globalThis.fetch(url, {
      signal: controller.signal,
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': HOST,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const want = (entry.country || 'us').toUpperCase();
  const data = (Array.isArray(json?.data) ? json.data : [])
    .filter(j => !j.job_country || j.job_country.toUpperCase() === want || j.job_is_remote);
  return data
    .map(j => ({
      title: j.job_title || '',
      url: j.job_apply_link || j.job_google_link || '',
      company: j.employer_name || 'Unknown',
      location: buildLocation(j) || (j.job_is_remote ? 'Remote' : ''),
      posted: j.job_posted_at_datetime_utc || (j.job_posted_at_timestamp ? new Date(j.job_posted_at_timestamp*1000).toISOString() : ''),
    }))
    .filter(job => job.url && job.title);
}
