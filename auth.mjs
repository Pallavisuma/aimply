/**
 * auth.mjs — minimal, dependency-free auth for the multi-user foundation.
 *
 * - Passwords hashed with Node's built-in scrypt (salt per user).
 * - Users persisted in data/users.json.
 * - Sessions persisted in data/.sessions.json (token -> {uid, exp}).
 * - Signed cookie not needed: tokens are random 32-byte hex, server-side store.
 *
 * Not a replacement for a managed auth provider, but a sound local base.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'crypto';

const USERS_PATH = 'data/users.json';
const SESSIONS_PATH = 'data/.sessions.json';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

mkdirSync('data', { recursive: true });

function readJSON(p, def){ try { return JSON.parse(readFileSync(p,'utf-8')); } catch { return def; } }
function writeJSON(p, o){ writeFileSync(p, JSON.stringify(o,null,2), 'utf-8'); }

function hash(pw, salt){ return scryptSync(pw, salt, 64).toString('hex'); }

export function listUsers(){ return readJSON(USERS_PATH, {}); }

export function getUserByEmail(email){
  const users = listUsers();
  return Object.values(users).find(u => u.email.toLowerCase() === String(email).toLowerCase()) || null;
}

export function createUser({ email, password, name }){
  if(!email || !password) return { error: 'Email and password required' };
  if(String(password).length < 6) return { error: 'Password must be at least 6 characters' };
  if(getUserByEmail(email)) return { error: 'An account with that email already exists' };
  const users = listUsers();
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  users[id] = { id, email: String(email).trim(), name: (name||'').trim(), salt, hash: hash(password, salt), createdAt: new Date().toISOString() };
  writeJSON(USERS_PATH, users);
  return { user: users[id] };
}

export function verifyUser(email, password){
  const u = getUserByEmail(email);
  if(!u) return null;
  const a = Buffer.from(hash(password, u.salt), 'hex');
  const b = Buffer.from(u.hash, 'hex');
  if(a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return u;
}

function sessions(){ return readJSON(SESSIONS_PATH, {}); }
export function createSession(uid){
  const s = sessions();
  // prune expired
  const now = Date.now();
  for(const t of Object.keys(s)) if(s[t].exp < now) delete s[t];
  const token = randomBytes(32).toString('hex');
  s[token] = { uid, exp: now + SESSION_TTL_MS };
  writeJSON(SESSIONS_PATH, s);
  return token;
}
export function getSessionUser(token){
  if(!token) return null;
  const s = sessions();
  const rec = s[token];
  if(!rec || rec.exp < Date.now()) return null;
  const users = listUsers();
  return users[rec.uid] || null;
}
export function destroySession(token){
  const s = sessions();
  if(s[token]){ delete s[token]; writeJSON(SESSIONS_PATH, s); }
}

export function parseCookie(header){
  const out = {};
  (header||'').split(';').forEach(p => { const i=p.indexOf('='); if(i>0) out[p.slice(0,i).trim()] = decodeURIComponent(p.slice(i+1).trim()); });
  return out;
}
export const SESSION_COOKIE = 'co_session';
const SECURE = process.env.COOKIE_SECURE==='1' ? '; Secure' : '';
export function sessionCookie(token){
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/${SECURE}; Max-Age=${SESSION_TTL_MS/1000}`;
}
export function clearCookie(){ return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/${process.env.COOKIE_SECURE==='1'?'; Secure':''}; Max-Age=0`; }
