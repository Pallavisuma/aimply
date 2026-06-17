#!/usr/bin/env node

/**
 * prune-history.mjs — remove non-US rows from data/scan-history.tsv.
 *
 * Rows that name a non-US location are dropped. Older rows saved before
 * location tracking have no location column; by default they're KEPT
 * (we can't prove they're foreign). Use --drop-unknown to also remove
 * those so the next US-only scan repopulates a clean list.
 *
 *   node prune-history.mjs                 # drop clearly-foreign rows
 *   node prune-history.mjs --drop-unknown  # also drop location-less rows
 *   node prune-history.mjs --strict        # treat blank location as foreign
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { isUSLocation } from './location.mjs';

const PATH = 'data/scan-history.tsv';
const dropUnknown = process.argv.includes('--drop-unknown');
const strict = process.argv.includes('--strict');

if (!existsSync(PATH)) { console.error('No data/scan-history.tsv'); process.exit(1); }

const lines = readFileSync(PATH, 'utf-8').split('\n');
const header = lines[0];
let kept = 0, dropped = 0, unknownKept = 0;
const out = [header];

for (const line of lines.slice(1)) {
  if (!line.trim()) continue;
  const parts = line.split('\t');
  const location = parts[6] || '';
  if (!location) {
    if (dropUnknown) { dropped++; continue; }
    unknownKept++; kept++; out.push(line); continue;
  }
  if (isUSLocation(location, { strict })) { kept++; out.push(line); }
  else dropped++;
}

copyFileSync(PATH, PATH + '.bak');
writeFileSync(PATH, out.join('\n') + '\n', 'utf-8');
console.log(`Pruned non-US rows. kept ${kept} (incl. ${unknownKept} location-unknown), dropped ${dropped}. Backup: ${PATH}.bak`);
if (unknownKept && !dropUnknown) console.log('Tip: many older rows have no location. Run with --drop-unknown then "npm run refresh" for a clean US-only list.');
