/**
 * Couche base de données des clés d'accès.
 * - SUPABASE_URL + SUPABASE_SECRET_KEY -> Supabase (recommandé) : clés ultra-persistantes.
 * - DATABASE_URL                        -> PostgreSQL direct (Neon, etc.).
 * - Fichier JSON local (keys.json)      -> Miroir de secours permanent.
 */
const fs = require('fs');
const path = require('path');

const JSON_FILE = path.join(process.env.DATA_DIR || __dirname, 'keys.json');

let pool = null;
let sb = null;
let mode = 'json';
const mem = new Map(); // key_code -> key object

const keyOf = (k) => String(k || '').trim();

// ---------------------------------------------------------------- JSON local
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
    const dir = path.dirname(JSON_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JSON_FILE, JSON.stringify([...mem.values()], null, 2), 'utf8');
  } catch (err) {
    if (mode === 'json') {
      console.error('[DB] Écriture keys.json impossible:', err.message);
    }
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

  loadJson();

  // Importer les clés de BDD vers la mémoire locale et synchro JSON
  const { rows } = await pool.query('SELECT * FROM keys');
  if (rows && rows.length > 0) {
    for (const r of rows) {
      const k = rowToKey(r);
      mem.set(k.keyCode, k);
    }
    saveJson();
  } else if (mem.size > 0) {
    for (const item of mem.values()) {
      await pool.query(
        `INSERT INTO keys (id, key_code, player_name, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [item.id, item.keyCode, item.playerName, item.expiresAt, item.createdAt]
      );
    }
    console.log(`[DB] ${mem.size} clé(s) importée(s) dans PostgreSQL.`);
  }
}

// -------------------------------------------------------------- Supabase
async function initSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const sbKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  sb = createClient(process.env.SUPABASE_URL, sbKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  loadJson();

  const { data, error } = await sb.from('keys').select('*');
  if (error) {
    const missing = error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message || '');
    throw new Error(missing
      ? 'table "keys" absente : exécute supabase/schema.sql dans Supabase → SQL Editor'
      : (error.message || error.code || 'erreur inconnue'));
  }

  if (data && data.length > 0) {
    for (const r of data) {
      const k = rowToKey(r);
      mem.set(k.keyCode, k);
    }
    saveJson();
  } else if (mem.size > 0) {
    for (const item of mem.values()) {
      await sb.from('keys').insert({
        id: item.id,
        key_code: item.keyCode,
        player_name: item.playerName,
        expires_at: item.expiresAt,
        created_at: item.createdAt,
      });
    }
    console.log(`[DB] ${mem.size} clé(s) importée(s) dans Supabase.`);
  }
}

// ------------------------------------------------------------------ API
async function init() {
  const sbKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (process.env.SUPABASE_URL && sbKey) {
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
    console.warn('[DB] ⚠️ Aucune BDD configurée : clés stockées en JSON local.');
  }
  loadJson();
  mode = 'json';
  return mode;
}

async function findKeyByCode(keyCode) {
  const k = keyOf(keyCode);
  if (!k) return null;

  if (mode === 'supabase') {
    try {
      const { data, error } = await sb.from('keys').select('*').eq('key_code', k).maybeSingle();
      if (!error && data) return rowToKey(data);
    } catch (e) {}
  }
  if (mode === 'postgres') {
    try {
      const { rows } = await pool.query('SELECT * FROM keys WHERE key_code = $1', [k]);
      if (rows && rows[0]) return rowToKey(rows[0]);
    } catch (e) {}
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

  mem.set(k, keyObj);
  saveJson();

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
    console.error('[DB] Erreur création Supabase:', error.message);
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
      console.error('[DB] Erreur création PostgreSQL:', err.message);
    }
  }

  return { ok: true, key: keyObj };
}

async function deleteKey(id) {
  for (const [k, v] of mem.entries()) {
    if (v.id === id) {
      mem.delete(k);
      break;
    }
  }
  saveJson();

  if (mode === 'supabase') {
    try {
      await sb.from('keys').delete().eq('id', id);
    } catch (e) {}
  }
  if (mode === 'postgres') {
    try {
      await pool.query('DELETE FROM keys WHERE id = $1', [id]);
    } catch (e) {}
  }
  return { ok: true };
}

async function getAllKeys() {
  if (mode === 'supabase') {
    try {
      const { data, error } = await sb.from('keys').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        const list = data.map(rowToKey);
        list.forEach((k) => mem.set(k.keyCode, k));
        saveJson();
        return list;
      }
    } catch (e) {}
  }
  if (mode === 'postgres') {
    try {
      const { rows } = await pool.query('SELECT * FROM keys ORDER BY created_at DESC');
      if (rows) {
        const list = rows.map(rowToKey);
        list.forEach((k) => mem.set(k.keyCode, k));
        saveJson();
        return list;
      }
    } catch (e) {}
  }
  return [...mem.values()].sort((a, b) => b.createdAt - a.createdAt);
}

async function countKeys() {
  if (mode === 'supabase') {
    try {
      const { count } = await sb.from('keys').select('id', { count: 'exact', head: true });
      if (count !== null) return count;
    } catch (e) {}
  }
  if (mode === 'postgres') {
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM keys');
      if (rows && rows[0]) return rows[0].n;
    } catch (e) {}
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
