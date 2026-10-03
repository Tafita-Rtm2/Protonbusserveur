/**
 * Couche base de données des clés d'accès.
 * - SUPABASE_URL + SUPABASE_SECRET_KEY -> Supabase (recommandé) : clés persistantes.
 * - DATABASE_URL                        -> PostgreSQL direct (Neon, etc.).
 * - Sinon                               -> repli sur un fichier JSON local (keys.json).
 */
const fs = require('fs');
const path = require('path');

const JSON_FILE = path.join(process.env.DATA_DIR || __dirname, 'keys.json');

let pool = null;
let sb = null;
let mode = 'json';
const mem = new Map(); // repli JSON : key_code -> key object

const keyOf = (k) => String(k || '').trim();

// ---------------------------------------------------------------- JSON
function loadJson() {
  try {
    if (!fs.existsSync(JSON_FILE)) return;
    const list = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const k = keyOf(item.keyCode || item.key_code);
      if (!k) continue;
      mem.set(k, {
        id: item.id,
        keyCode: k,
        playerName: item.playerName || item.player_name,
        expiresAt: item.expiresAt !== undefined ? item.expiresAt : (item.expires_at !== undefined ? item.expires_at : null),
        createdAt: item.createdAt || item.created_at || Date.now(),
      });
    }
  } catch (err) {
    console.error('[DB] Lecture keys.json impossible:', err.message);
  }
}

function saveJson() {
  try {
    fs.writeFileSync(JSON_FILE, JSON.stringify([...mem.values()], null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Écriture keys.json impossible:', err.message);
  }
}

// ------------------------------------------------------------ PostgreSQL
const SCHEMA = `
CREATE TABLE IF NOT EXISTS keys (
  id           TEXT PRIMARY KEY,
  key_code     TEXT NOT NULL UNIQUE,
  player_name  TEXT NOT NULL,
  expires_at   BIGINT,
  created_at   BIGINT NOT NULL
);`;

const rowToKey = (r) => ({
  id: r.id,
  keyCode: r.key_code,
  playerName: r.player_name,
  expiresAt: r.expires_at ? Number(r.expires_at) : null,
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

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM keys');
  if (rows[0].n === 0) {
    loadJson();
    for (const item of mem.values()) {
      await pool.query(
        `INSERT INTO keys (id, key_code, player_name, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [item.id, item.keyCode, item.playerName, item.expiresAt, item.createdAt]
      );
    }
    if (mem.size) console.log(`[DB] ${mem.size} ancienne(s) clé(s) importée(s) dans PostgreSQL.`);
  }
}

// -------------------------------------------------------------- Supabase
async function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { count, error } = await sb.from('keys').select('id', { count: 'exact', head: true });
  if (error) {
    const missing = error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '');
    throw new Error(missing
      ? 'table "keys" absente : exécute supabase/schema.sql dans Supabase → SQL Editor'
      : (error.message || error.code || 'erreur inconnue'));
  }
  if (count === 0) {
    loadJson();
    for (const item of mem.values()) {
      await sb.from('keys').insert({
        id: item.id,
        key_code: item.keyCode,
        player_name: item.playerName,
        expires_at: item.expiresAt,
        created_at: item.createdAt,
      });
    }
    if (mem.size) console.log(`[DB] ${mem.size} ancienne(s) clé(s) importée(s) dans Supabase.`);
  }
}

// ------------------------------------------------------------------ API
async function init() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    try {
      await initSupabase();
      mode = 'supabase';
      console.log('[DB] Supabase connecté ✔ (Clés persistantes)');
      return mode;
    } catch (err) {
      console.error('[DB] ⚠️ Supabase inaccessible, repli sur JSON:', err.message);
      sb = null;
    }
  }
  if (process.env.DATABASE_URL) {
    try {
      await initPostgres();
      mode = 'postgres';
      console.log('[DB] PostgreSQL connecté ✔ (Clés persistantes)');
      return mode;
    } catch (err) {
      console.error('[DB] ⚠️ PostgreSQL inaccessible, repli sur JSON:', err.message);
      pool = null;
    }
  } else if (!process.env.SUPABASE_URL) {
    console.warn('[DB] ⚠️ Aucune BDD configurée : clés stockées en JSON.');
  }
  loadJson();
  mode = 'json';
  return mode;
}

async function findKeyByCode(keyCode) {
  const k = keyOf(keyCode);
  if (!k) return null;
  if (mode === 'supabase') {
    const { data, error } = await sb.from('keys').select('*').eq('key_code', k).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? rowToKey(data) : null;
  }
  if (mode === 'postgres') {
    const { rows } = await pool.query('SELECT * FROM keys WHERE key_code = $1', [k]);
    return rows[0] ? rowToKey(rows[0]) : null;
  }
  return mem.get(k) || null;
}

async function createKey(item) {
  const k = keyOf(item.keyCode);
  const keyObj = {
    id: item.id,
    keyCode: k,
    playerName: item.playerName,
    expiresAt: item.expiresAt ?? null,
    createdAt: item.createdAt || Date.now(),
  };

  if (mode === 'supabase') {
    const { error } = await sb.from('keys').insert({
      id: keyObj.id,
      key_code: keyObj.keyCode,
      player_name: keyObj.playerName,
      expires_at: keyObj.expiresAt,
      created_at: keyObj.createdAt,
    });
    if (!error) return { ok: true, key: keyObj };
    if (error.code === '23505') return { ok: false, conflict: true };
    throw new Error(error.message);
  }
  if (mode === 'postgres') {
    try {
      await pool.query(
        'INSERT INTO keys (id, key_code, player_name, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
        [keyObj.id, keyObj.keyCode, keyObj.playerName, keyObj.expiresAt, keyObj.createdAt]
      );
      return { ok: true, key: keyObj };
    } catch (err) {
      if (err.code === '23505') return { ok: false, conflict: true };
      throw err;
    }
  }
  if (mem.has(k)) return { ok: false, conflict: true };
  mem.set(k, keyObj);
  saveJson();
  return { ok: true, key: keyObj };
}

async function deleteKey(id) {
  if (mode === 'supabase') {
    const { error } = await sb.from('keys').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  if (mode === 'postgres') {
    await pool.query('DELETE FROM keys WHERE id = $1', [id]);
    return { ok: true };
  }
  for (const [k, v] of mem.entries()) {
    if (v.id === id) {
      mem.delete(k);
      saveJson();
      break;
    }
  }
  return { ok: true };
}

async function getAllKeys() {
  if (mode === 'supabase') {
    const { data, error } = await sb.from('keys').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToKey);
  }
  if (mode === 'postgres') {
    const { rows } = await pool.query('SELECT * FROM keys ORDER BY created_at DESC');
    return rows.map(rowToKey);
  }
  return [...mem.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function countKeys() {
  if (mode === 'supabase') {
    const { count } = await sb.from('keys').select('id', { count: 'exact', head: true });
    return count || 0;
  }
  if (mode === 'postgres') {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM keys');
    return rows[0].n;
  }
  return mem.size;
}

module.exports = {
  init,
  findKeyByCode,
  createKey,
  deleteKey,
  getAllKeys,
  countKeys,
  getMode: () => mode,
};
