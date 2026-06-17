#!/usr/bin/env node

/**
 * tailor.mjs — tailor cv.md to a specific job description (Gemini).
 *
 * Reads your master resume (cv.md) + config/profile.yml, fetches the
 * job description, and asks Gemini to produce a TRUTHFUL, reordered/
 * re-emphasized one-page resume tailored to that JD. Outputs Markdown,
 * an ATS-friendly HTML, and a PDF (via generate-pdf.mjs).
 *
 * Truthfulness guardrail: the prompt forbids inventing employers,
 * dates, titles, or metrics. It may only reorder, rephrase, and
 * emphasize what's already in cv.md.
 *
 * Env: GEMINI_API_KEY  (free at https://aistudio.google.com/apikey)
 *
 * Usage:
 *   node tailor.mjs --url <jobUrl>
 *   node tailor.mjs --url <jobUrl> --jd "paste JD text"
 *   node tailor.mjs --company "Acme" --role "ML Engineer" --jd "..."
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';
import yaml from 'js-yaml';

const DATA_DIR = process.env.CAREER_OPS_DATA_DIR || 'data';
const OUT_DIR = process.env.CAREER_OPS_TAILORED || `${DATA_DIR}/tailored`;
const CV_PATH = process.env.CAREER_OPS_CV || 'cv.md';
const PROFILE_PATH = process.env.CAREER_OPS_PROFILE || 'config/profile.yml';

function arg(name, def = null) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : def;
}

function slug(s) {
  return (s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

async function fetchJD(url) {
  if (!url) return '';
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(t);
    if (!res.ok) return '';
    const html = await res.text();
    // crude HTML -> text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } catch {
    return '';
  }
}

// Minimal, safe Markdown -> HTML (headings, bold, italics, lists, links, paragraphs).
function mdToHtml(md) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  const lines = md.split('\n');
  let html = '', inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^#\s+/.test(line)) { closeList(); html += `<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`; }
    else if (/^##\s+/.test(line)) { closeList(); html += `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`; }
    else if (/^###\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`; }
    else if (/^\s*[-*]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`; }
    else if (line.trim() === '') { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

function wrapHtml(name, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name} — Resume</title>
<style>
  body{font:11pt/1.4 -apple-system,"Segoe UI",Arial,sans-serif;color:#111;max-width:8.5in;margin:0 auto;padding:0.55in 0.6in}
  h1{font-size:20pt;margin:0 0 2px}
  h1+p{margin:0 0 10px;color:#444;font-size:10pt}
  h2{font-size:12pt;border-bottom:1.5px solid #222;padding-bottom:2px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.5px}
  h3{font-size:11pt;margin:8px 0 1px}
  p{margin:3px 0}
  ul{margin:3px 0 6px;padding-left:18px}
  li{margin:2px 0}
  a{color:#111;text-decoration:none}
</style></head><body>${bodyHtml}</body></html>`;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey and add it to .env');
    process.exit(1);
  }
  if (!existsSync(CV_PATH)) { console.error('cv.md not found'); process.exit(1); }

  const url = arg('url');
  let jd = arg('jd') || '';
  const company = arg('company') || '';
  let role = arg('role') || '';
  if (!jd && url) jd = await fetchJD(url);
  if (!jd && !role) { console.error('Provide --jd, --url, or --role'); process.exit(1); }

  const cv = readFileSync(CV_PATH, 'utf-8');
  const profile = existsSync(PROFILE_PATH) ? readFileSync(PROFILE_PATH, 'utf-8') : '';

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  const prompt = `You are an expert technical resume writer. Tailor the candidate's MASTER RESUME to the TARGET JOB.

STRICT RULES (truthfulness):
- Use ONLY facts present in the master resume. Do NOT invent employers, titles, dates, degrees, or metrics.
- You MAY reorder sections/bullets, rephrase for impact, surface the most relevant skills first, and rewrite the Summary to mirror the job's language.
- Keep it to ONE page of content. Keep the contact line exactly as in the master resume.
- Output GitHub-flavored Markdown ONLY (no code fences, no commentary). Start with the candidate's name as an H1.

=== CANDIDATE PROFILE (context) ===
${profile}

=== MASTER RESUME (cv.md) ===
${cv}

=== TARGET JOB ${company ? '(' + company + ')' : ''} ===
${jd || ('Role: ' + role)}
`;

  console.error('Tailoring with Gemini…');
  const result = await model.generateContent(prompt);
  let md = result.response.text().trim();
  md = md.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();

  if (!role) {
    const m = jd.match(/(senior |staff |lead )?(ml|ai|machine learning|software|backend|data)[a-z ]*engineer/i);
    role = m ? m[0] : 'role';
  }
  const base = `${slug(company)}__${slug(role)}`;
  mkdirSync(OUT_DIR, { recursive: true });
  const mdPath = `${OUT_DIR}/${base}.md`;
  const htmlPath = `${OUT_DIR}/${base}.html`;
  const pdfPath = `${OUT_DIR}/${base}.pdf`;
  writeFileSync(mdPath, md, 'utf-8');

  const nameLine = (md.match(/^#\s+(.+)$/m) || [, 'Resume'])[1];
  writeFileSync(htmlPath, wrapHtml(nameLine, mdToHtml(md)), 'utf-8');

  // PDF via existing generator (Playwright). Non-fatal if it fails.
  const r = spawnSync('node', ['generate-pdf.mjs', htmlPath, pdfPath], { encoding: 'utf-8' });
  const pdfOk = r.status === 0 && existsSync(pdfPath);

  console.log(JSON.stringify({
    ok: true, company, role,
    markdown: mdPath, html: htmlPath,
    pdf: pdfOk ? pdfPath : null,
    pdfNote: pdfOk ? null : 'PDF step failed — run: npx playwright install chromium',
  }));
}

main().catch(e => { console.error(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
