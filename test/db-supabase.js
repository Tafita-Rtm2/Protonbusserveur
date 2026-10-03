/* Test du mode Supabase avec une fausse API supabase-js (aucun accès réseau). */
const Module = require('module');
const rows = new Map();
let tableExists = true;

const fakeClient = {
  from: () => {
    const q = { _f: null, _head: false };
    q.select = (cols, opts) => { q._head = !!opts?.head; return q; };
    q.eq = (c, v) => { q._f = [c, v]; return q; };
    q.order = () => q;
    q.delete = () => q;
    q.maybeSingle = async () => ({ data: [...rows.values()].find((r) => r[q._f[0]] === q._f[1]) || null, error: null });
    q.insert = async (r) => {
      if (rows.has(r.key_code)) return { error: { code: '23505', message: 'dup' } };
      rows.set(r.key_code, r); return { error: null };
    };
    q.then = (res) => res(tableExists ? { count: rows.size, data: [...rows.values()], error: null } : { count: null, data: null, error: { code: 'PGRST205', message: 'schema cache' } });
    return q;
  },
};

const orig = Module._load;
Module._load = function (req, ...a) { return req === '@supabase/supabase-js' ? { createClient: () => fakeClient } : orig.call(this, req, ...a); };
process.env.SUPABASE_URL = 'https://x.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_fake';
process.env.DATA_DIR = '/tmp/nodata';

let p = 0, f = 0;
const ok = (c, m) => { c ? (p++, console.log('  ✔', m)) : (f++, console.log('  ✘ FAIL:', m)); };

(async () => {
  const db = require('../db');
  ok(await db.init() === 'supabase', 'mode supabase activé');

  const keyObj = { id: 'k1', keyCode: 'KEY-1234-ABCD', playerName: 'Tafita', expiresAt: null, createdAt: Date.now() };
  ok((await db.createKey(keyObj)).ok, 'création de clé');
  ok((await db.createKey({ ...keyObj, id: 'k2' })).conflict === true, 'clé en doublon => conflit');

  const got = await db.findKeyByCode('KEY-1234-ABCD');
  ok(got && got.playerName === 'Tafita', 'recherche de clé par code');
  ok(await db.findKeyByCode('KEY-INEXISTANTE') === null, 'clé inconnue => null');
  ok(await db.countKeys() === 1, 'comptage des clés');

  delete require.cache[require.resolve('../db')];
  tableExists = false;
  const db2 = require('../db');
  ok(await db2.init() === 'json', 'table absente => repli JSON');

  console.log(`\n${p} OK, ${f} échec(s)`); process.exit(f ? 1 : 0);
})();
