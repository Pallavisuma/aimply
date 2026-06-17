/**
 * storage.mjs — per-user data isolation.
 *
 * Each user gets data/users/<uid>/ with their own portals, resume,
 * profile, job history, applications, and tailored resumes. Seeded
 * from the repo's base files on first login.
 */

import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'fs';
import yaml from 'js-yaml';

export function userDir(uid){ return `data/users/${uid}`; }

export function userPaths(uid){
  const d = userDir(uid);
  return {
    dir: d,
    portals: `${d}/portals.yml`,
    cv: `${d}/cv.md`,
    profile: `${d}/profile.yml`,
    history: `${d}/scan-history.tsv`,
    pipeline: `${d}/pipeline.md`,
    applications: `${d}/applications.json`,
    tailored: `${d}/tailored`,
  };
}

// Env to pass to child scripts (scan/tailor/dashboard/digest/prefill).
export function userEnv(uid){
  const p = userPaths(uid);
  return {
    ...process.env,
    CAREER_OPS_DATA_DIR: p.dir,
    CAREER_OPS_PORTALS: p.portals,
    CAREER_OPS_CV: p.cv,
    CAREER_OPS_PROFILE: p.profile,
    CAREER_OPS_TAILORED: p.tailored,
  };
}

export function seedUser(uid, { name, email } = {}){
  const p = userPaths(uid);
  mkdirSync(p.tailored, { recursive: true });

  // Company list + default AI/ML searches are generic — fine to copy.
  if(!existsSync(p.portals) && existsSync('portals.yml')) copyFileSync('portals.yml', p.portals);

  // Résumé and profile must NOT inherit anyone else's data — start clean.
  if(!existsSync(p.cv)){
    writeFileSync(p.cv, `# ${name||'Your Name'}\n\n_Upload your résumé from “Set my target roles / upload a résumé” to personalize tailoring._\n`, 'utf-8');
  }
  if(!existsSync(p.profile)){
    let target = {};
    try { const base = existsSync('config/profile.yml') ? yaml.load(readFileSync('config/profile.yml','utf-8')) : {}; target = base.target_roles || {}; } catch {}
    const clean = {
      candidate: { full_name: name||'', email: email||'', phone:'', location:'', linkedin:'', github:'', portfolio_url:'' },
      target_roles: target,
      location: { visa_status:'' },
    };
    writeFileSync(p.profile, yaml.dump(clean), 'utf-8');
  }
  if(!existsSync(p.history)) writeFileSync(p.history, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf-8');
  if(!existsSync(p.pipeline)) writeFileSync(p.pipeline, '# Pipeline\n\n## Pendientes\n\n', 'utf-8');
  if(!existsSync(p.applications)) writeFileSync(p.applications, '{}', 'utf-8');
  return p;
}
