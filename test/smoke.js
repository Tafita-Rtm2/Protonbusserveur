/* Test de bout en bout pour le système de Clés & Admin : node test/smoke.js */
const { spawn, execSync } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7861, URL = `http://127.0.0.1:${PORT}`, KEY = 'testkey', ADMIN_CODE = '2201018280121206';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✔', m); } else { failed++; console.log('  ✘ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (p, body, headers = {}, method = 'POST') => fetch(URL + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const emit = (s, ev, p) => new Promise((res) => { const t = setTimeout(() => res({ ok: false, timeout: true }), 2000); const cb = (r) => { clearTimeout(t); res(r); }; if (p === undefined) s.emit(ev, cb); else s.emit(ev, p, cb); });
const conn = (auth) => new Promise((res, rej) => { const s = io(URL, { auth, transports: ['polling'] }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const once = (s, ev, ms = 1500) => new Promise((res) => { const t = setTimeout(() => res(null), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });

(async () => {
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`); } catch (e) {}
  require('fs').rmSync('/tmp/keys.json', { force: true });
  const srv = spawn('node', ['server.js'], { env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent', PORT, API_PROXY_KEY: KEY, ADMIN_CODE, JWT_SECRET: 'x'.repeat(40), DATA_DIR: '/tmp', ALLOWED_ORIGINS: 'https://site.test' }, stdio: 'pipe' });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(1500);

  const H = { 'x-proxy-key': KEY };

  console.log('1. Sécurité Admin & Anti Brute-force (4 tentatives)');
  const r0 = await rest('/api/admin/login', { adminCode: 'mauvais' });
  ok(r0.status === 404, 'Admin login sans clé proxy => 404');

  const r1 = await rest('/api/admin/login', { adminCode: '0000' }, H);
  ok(r1.status === 401, 'Tentative 1 échec => 401');

  const r2 = await rest('/api/admin/login', { adminCode: '0000' }, H);
  ok(r2.status === 401, 'Tentative 2 échec => 401');

  const r3 = await rest('/api/admin/login', { adminCode: '0000' }, H);
  ok(r3.status === 401, 'Tentative 3 échec => 401');

  const r4 = await rest('/api/admin/login', { adminCode: '0000' }, H);
  ok(r4.status === 429 && r4.body.locked === true, 'Tentative 4 échec => Bannissement 1 heure (429)');

  srv.kill('SIGKILL');
  await sleep(1500);
  try { execSync(`fuser -k ${PORT}/tcp 2>/dev/null || true`); } catch (e) {}
  await sleep(500);

  const srv2 = spawn('node', ['server.js'], { env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent', PORT, API_PROXY_KEY: KEY, ADMIN_CODE, JWT_SECRET: 'x'.repeat(40), DATA_DIR: '/tmp', ALLOWED_ORIGINS: 'https://site.test' }, stdio: 'pipe' });
  srv2.stdout.on('data', () => {}); srv2.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(1500);

  console.log('\n2. Connexion Administrateur & Génération de Clés');
  const adminLogin = await rest('/api/admin/login', { adminCode: ADMIN_CODE }, H);
  ok(adminLogin.status === 200 && adminLogin.body.token, 'Connexion Admin réussie');
  const adminTok = adminLogin.body.token;

  const key1Res = await rest('/api/admin/keys/generate', { playerName: 'Miantavola', duration: '7d' }, { ...H, authorization: `Bearer ${adminTok}` });
  ok(key1Res.status === 201 && key1Res.body.key?.keyCode, 'Génération de clé pour Miantavola');
  const key1 = key1Res.body.key;

  const key2Res = await rest('/api/admin/keys/generate', { playerName: 'ChauffeurTana', duration: '24h' }, { ...H, authorization: `Bearer ${adminTok}` });
  const key2 = key2Res.body.key;
  ok(key2?.keyCode && key2.playerName === 'ChauffeurTana', 'Génération de clé pour ChauffeurTana');

  const keysList = await rest('/api/admin/keys', null, { ...H, authorization: `Bearer ${adminTok}` }, 'GET');
  ok(keysList.body.keys?.length === 2, 'Lister les clés (2 clés)');

  console.log('\n3. Connexion Joueur par Clé');
  ok((await rest('/api/login-key', { key: 'KEY-INEXISTANTE' }, H)).status === 401, 'Clé inexistante refusée (401)');
  const player1Login = await rest('/api/login-key', { key: key1.keyCode }, H);
  ok(player1Login.status === 200 && player1Login.body.user.username === 'Miantavola', 'Connexion réussie avec clé 1');
  const player1Tok = player1Login.body.token;

  const meRes = await rest('/api/me', null, { ...H, authorization: `Bearer ${player1Tok}` }, 'GET');
  ok(meRes.body.user?.username === 'Miantavola', '/api/me renvoie le nom du joueur de la clé');

  console.log('\n4. Socket.io & Multijoueur avec Clé (Option A : Session unique)');
  const p1Socket = await conn({ token: player1Tok, client: 'web' });
  ok(!!p1Socket.id, 'Socket Joueur 1 connecté');

  try {
    await conn({ token: player1Tok, client: 'web' });
    ok(false, 'Seconde connexion refusée');
  } catch (err) {
    ok(err.message === 'KEY_ALREADY_ACTIVE' || err.data?.code === 'KEY_ALREADY_ACTIVE', 'Option A : Seconde connexion bloquée (KEY_ALREADY_ACTIVE)');
  }

  const p2Login = await rest('/api/login-key', { key: key2.keyCode }, H);
  const p2Socket = await conn({ token: p2Login.body.token, client: 'web' });

  const roomRes = await emit(p1Socket, 'createRoom', { roomName: 'Convoi Tana', mapId: 'map_tana', busId: 'bus_default' });
  ok(roomRes.ok && roomRes.room.hostUsername === 'Miantavola', 'Joueur 1 crée une room sous son nom de clé');

  await emit(p2Socket, 'joinRoom', { roomId: roomRes.room.id });
  const chatEv = once(p2Socket, 'roomChat');
  p1Socket.emit('roomChat', { text: 'En route vers Tamatave !' });
  ok((await chatEv)?.text === 'En route vers Tamatave !', 'Chat relayé entre joueurs avec clés');

  p1Socket.close();
  p2Socket.close();
  srv2.kill('SIGKILL');

  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
