/* Test du mode Supabase avec une fausse API supabase-js (aucun accès réseau). */
const Module = require('module');
const rows = new Map();
let tableExists = true;
const fakeClient = {
  from: () => {
    const q = { _f: null, _head: false };
    q.select = (cols, opts) => { q._head = !!opts?.head; return q; };
    q.eq = (c, v) => { q._f = [c, v]; return q; };
    q.maybeSingle = async () => ({ data: [...rows.values()].find((r) => r[q._f[0]] === q._f[1]) || null, error: null });
    q.insert = async (r) => {
      if (rows.has(r.username_key)) return { error: { code: '23505', message: 'dup' } };
      rows.set(r.username_key, r); return { error: null };
    };
    q.then = (res) => res(tableExists ? { count: rows.size, error: null } : { count: null, error: { code: 'PGRST205', message: 'schema cache' } });
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
  const u = { id: 'u1', username: 'Tafita', pseudo: 'Tafita', passwordHash: 'h', createdAt: 1 };
  ok((await db.createUser(u)).ok, 'création de compte');
  ok((await db.createUser({ ...u, id: 'u2', username: 'TAFITA' })).conflict === true, 'doublon => conflit');
  const got = await db.findUserByName('tafita');
  ok(got && got.username === 'Tafita' && got.passwordHash === 'h', 'recherche insensible à la casse');
  ok(await db.findUserByName('inconnu') === null, 'inconnu => null');
  ok(await db.countUsers() === 1, 'comptage');

  delete require.cache[require.resolve('../db')];
  tableExists = false;
  const db2 = require('../db');
  ok(await db2.init() === 'json', 'table absente => repli JSON (avec message clair)');
  console.log(`\n${p} OK, ${f} échec(s)`); process.exit(f ? 1 : 0);
})();
