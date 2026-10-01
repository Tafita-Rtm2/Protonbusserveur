/**
 * Couche base de données des comptes.
 * - SUPABASE_URL + SUPABASE_SECRET_KEY -> Supabase (recommandé) : comptes persistants.
 * - DATABASE_URL                        -> PostgreSQL direct (Neon, etc.).
 * - Sinon                               -> repli sur un fichier JSON local (éphémère sur Hugging Face !).
 */
const fs = require('fs');
const path = require('path');

const JSON_FILE = path.join(process.env.DATA_DIR || __dirname, 'users.json');

let pool = null;
let sb = null;
let mode = 'json';
const mem = new Map(); // repli JSON : clé (username en minuscules) -> user

const keyOf = (name) => String(name || '').trim().toLowerCase();

// ---------------------------------------------------------------- JSON
function loadJson() {
  try {
    if (!fs.existsSync(JSON_FILE)) return;
    const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    if (!Array.isArray(list)) return;
    for (const u of list) {
      const k = keyOf(u.username || u.pseudo);
      if (!k) continue;
      mem.set(k, {
        id: u.id,
        username: u.username || u.pseudo,
        pseudo: u.pseudo || u.username,
        passwordHash: u.passwordHash,
        createdAt: u.createdAt || Date.now(),
      });
    }
  } catch (err) {
    console.error('[DB] Lecture users.json impossible:', err.message);
  }
}

function saveJson() {
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify([...mem.values()], null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Écriture users.json impossible:', err.message);
  }
}

// ------------------------------------------------------------ PostgreSQL
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  username_key  TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);`;

const rowToUser = (r) => ({
  id: r.id,
  username: r.username,
  pseudo: r.username,
  passwordHash: r.password_hash,
  createdAt: Number(r.created_at),
});

async function initPostgres() {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (e) => console.error('[DB] pool error:', e.message));
  await pool.query(SCHEMA);

  // Import unique des anciens comptes users.json si la table est vide
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    loadJson();
    for (const u of mem.values()) {
      await pool.query(
        `INSERT INTO users (id, username, username_key, password_hash, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [u.id, u.username, keyOf(u.username), u.passwordHash, u.createdAt]
      );
    }
    if (mem.size) console.log(`[DB] ${mem.size} ancien(s) compte(s) importé(s) dans PostgreSQL.`);
    mem.clear();
  }
}

// -------------------------------------------------------------- Supabase
async function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { count, error } = await sb.from('users').select('id', { count: 'exact', head: true });
  if (error) {
    const missing = error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '');
    throw new Error(missing
      ? 'table "users" absente : exécute supabase/schema.sql dans Supabase → SQL Editor'
      : (error.message || error.code || 'erreur inconnue'));
  }
  // Import unique des anciens comptes users.json si la table est vide
  if (count === 0) {
    loadJson();
    for (const u of mem.values()) {
      await sb.from('users').insert({
        id: u.id, username: u.username, username_key: keyOf(u.username), password_hash: u.passwordHash, created_at: u.createdAt,
      });
    }
    if (mem.size) console.log(`[DB] ${mem.size} ancien(s) compte(s) importé(s) dans Supabase.`);
    mem.clear();
  }
}

// ------------------------------------------------------------------ API
async function init() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    try {
      await initSupabase();
      mode = 'supabase';
      console.log('[DB] Supabase connecté ✔');
      return mode;
    } catch (err) {
      console.error('[DB] ⚠️  Supabase inaccessible, repli (comptes NON persistants):', err.message);
      sb = null;
    }
  }
  if (process.env.DATABASE_URL) {
    try {
      await initPostgres();
      mode = 'postgres';
      console.log('[DB] PostgreSQL connecté ✔');
      return mode;
    } catch (err) {
      console.error('[DB] ⚠️  PostgreSQL inaccessible, repli sur JSON (comptes NON persistants):', err.message);
      pool = null;
    }
  } else if (!process.env.SUPABASE_URL) {
    console.warn('[DB] ⚠️  Aucune base configurée : comptes stockés en JSON éphémère.');
  }
  loadJson();
  mode = 'json';
  return mode;
}

async function findUserByName(name) {
  const k = keyOf(name);
  if (!k) return null;
  if (mode === 'supabase') {
    const { data, error } = await sb.from('users').select('*').eq('username_key', k).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToUser(data) : null;
  }
  if (mode === 'postgres') {
    const { rows } = await pool.query('SELECT * FROM users WHERE username_key = $1', [k]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  return mem.get(k) || null;
}

/** @returns {Promise<{ok:true}|{ok:false, conflict:true}>} */
async function createUser(user) {
  const k = keyOf(user.username);
  if (mode === 'supabase') {
    const { error } = await sb.from('users').insert({
      id: user.id, username: user.username, username_key: k, password_hash: user.passwordHash, created_at: user.createdAt,
    });
    if (!error) return { ok: true };
    if (error.code === '23505') return { ok: false, conflict: true };
    throw new Error(error.message);
  }
  if (mode === 'postgres') {
    try {
      await pool.query(
        'INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)',
        [user.id, user.username, k, user.passwordHash, user.createdAt]
      );
      return { ok: true };
    } catch (err) {
      if (err.code === '23505') return { ok: false, conflict: true };
      throw err;
    }
  }
  if (mem.has(k)) return { ok: false, conflict: true };
  mem.set(k, user);
  saveJson();
  return { ok: true };
}

async function countUsers() {
  if (mode === 'supabase') {
    const { count } = await sb.from('users').select('id', { count: 'exact', head: true });
    return count || 0;
  }
  if (mode === 'postgres') {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    return rows[0].n;
  }
  return mem.size;
}

module.exports = { init, findUserByName, createUser, countUsers, getMode: () => mode };
