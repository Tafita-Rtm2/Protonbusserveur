/* Test de bout en bout : node test/smoke.js (lance le serveur lui-même) */
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7861, URL = `http://127.0.0.1:${PORT}`, KEY = 'testkey';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✔', m); } else { failed++; console.log('  ✘ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rest = (p, body, headers = {}, method = 'POST') => fetch(URL + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const emit = (s, ev, p) => new Promise((res) => { const t = setTimeout(() => res({ ok: false, timeout: true }), 2000); const cb = (r) => { clearTimeout(t); res(r); }; if (p === undefined) s.emit(ev, cb); else s.emit(ev, p, cb); });
const conn = (auth) => new Promise((res, rej) => { const s = io(URL, { auth, transports: ['websocket'] }); s.on('connect', () => res(s)); s.on('connect_error', rej); });
const once = (s, ev, ms = 1500) => new Promise((res) => { const t = setTimeout(() => res(null), ms); s.once(ev, (d) => { clearTimeout(t); res(d); }); });

(async () => {
  require('fs').rmSync('/tmp/users.json', { force: true });
  const srv = spawn('node', ['server.js'], { env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent', PORT, API_PROXY_KEY: KEY, JWT_SECRET: 'x'.repeat(40), DATA_DIR: '/tmp', ALLOWED_ORIGINS: 'https://site.test' }, stdio: 'pipe' });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', (d) => process.stderr.write(d));
  await sleep(1200);

  console.log('REST / sécurité');
  ok((await rest('/api/login', { username: 'a', password: 'b' })).status === 404, 'login sans clé proxy => 404 (caché)');
  const H = { 'x-proxy-key': KEY };
  ok((await rest('/api/register', { username: 'ab', password: '123456' }, H)).status === 400, 'pseudo trop court refusé');
  ok((await rest('/api/register', { username: 'Alice', password: '123' }, H)).status === 400, 'mot de passe court refusé');
  const reg = await rest('/api/register', { username: 'Alice', password: 'secret12' }, H);
  ok(reg.status === 201 && reg.body.token, 'inscription Alice');
  ok((await rest('/api/register', { username: 'alice', password: 'secret12' }, H)).status === 409, 'doublon (insensible à la casse) refusé');
  const bad = await rest('/api/login', { username: 'Alice', password: 'mauvais' }, H);
  ok(bad.status === 401, 'mauvais mot de passe => 401');
  const tokA = (await rest('/api/login', { username: 'Alice', password: 'secret12' }, H)).body.token;
  ok(!!tokA, 'connexion Alice');
  const tokB = (await rest('/api/register', { username: 'Bob', password: 'secret12' }, H)).body.token;
  const tokC = (await rest('/api/register', { username: 'Chloe', password: 'secret12' }, H)).body.token;
  ok((await rest('/api/me', null, { ...H, authorization: 'Bearer ' + tokA }, 'GET')).body.user?.username === 'Alice', '/api/me');
  ok((await rest('/api/me', null, { ...H, authorization: 'Bearer faux' }, 'GET')).status === 401, '/api/me token faux => 401');
  ok((await rest('/api/stats', null, {}, 'GET')).status === 404, '/api/stats caché');
  const hdr = await fetch(URL + '/', { headers: { origin: 'https://evil.test' } });
  ok(hdr.headers.get('access-control-allow-origin') === null, 'CORS : origine inconnue refusée');
  ok((await fetch(URL + '/', { headers: { origin: 'https://site.test' } })).headers.get('access-control-allow-origin') === 'https://site.test', 'CORS : origine autorisée');

  console.log('Multijoueur (compat mod sans token + comptes)');
  const mod = await conn({});                 // comme le mod actuel : pas de token
  const alice = await conn({ token: tokA, client: 'web' });
  const bob = await conn({ token: tokB, client: 'web' });
  const chloe = await conn({ token: tokC, client: 'web' });
  const created = await emit(alice, 'createRoom', { roomName: 'Tana Express', mapId: 'map_tana', busId: 'bus_default', maxPlayers: 4, password: 'pw' });
  ok(created.ok && created.room.hostUsername === 'Alice', 'Alice crée une room (pseudo du compte)');
  const rid = created.room.id;
  ok(!(await emit(mod, 'joinRoom', { roomId: rid, password: 'faux' })).ok, 'mauvais mot de passe refusé');
  ok((await emit(mod, 'joinRoom', { roomId: rid, password: 'pw', mapId: 'autre' })).code === 'MAP_MISMATCH', 'map incompatible refusée');
  const gotState = once(mod, 'roomState');
  ok((await emit(mod, 'joinRoom', { roomId: rid, password: 'pw', mapId: 'map_tana', busId: 'bus_default', pseudo: 'ModJoueur' })).ok, 'joueur sans token (mod) rejoint');
  ok((await gotState)?.players?.length === 1, 'roomState reçu');
  ok((await emit(bob, 'joinRoom', { roomId: rid, password: 'pw' })).ok, 'Bob rejoint');

  const gotUpd = once(bob, 'vehicleUpdate');
  mod.emit('vehicleUpdate', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, throttle: 1, busInfo: { busName: 'X' } });
  const upd = await gotUpd;
  ok(upd && upd.position.x === 1 && upd.username === 'ModJoueur' && upd.busInfo.busName === 'X', 'vehicleUpdate relayé (busInfo inclus)');

  const chat = once(bob, 'roomChat');
  alice.emit('roomChat', { text: 'Salut !' });
  ok((await chat)?.text === 'Salut !', 'chat de room');

  console.log('Vocal');
  const r1 = await emit(alice, 'voice:join', {});
  ok(r1.ok && r1.peers.length === 0 && r1.iceServers.length > 0, 'Alice rejoint le vocal (aucun pair)');
  const pj = once(alice, 'voice:peer-joined');
  const r2 = await emit(bob, 'voice:join', {});
  ok(r2.peers.length === 1 && r2.peers[0].socketId === alice.id, 'Bob voit Alice dans le vocal');
  ok((await pj)?.socketId === bob.id, 'Alice notifiée');
  const sig = once(alice, 'voice:signal');
  bob.emit('voice:signal', { to: alice.id, data: { sdp: { type: 'offer', sdp: 'v=0' } } });
  ok((await sig)?.from === bob.id, 'signal WebRTC relayé');
  const sig2 = once(mod, 'voice:signal', 400);
  bob.emit('voice:signal', { to: mod.id, data: { sdp: 1 } });
  ok((await sig2) === null, 'signal vers un joueur hors vocal bloqué');

  console.log('Modération');
  ok((await emit(bob, 'kickPlayer', { socketId: alice.id })).ok === false, 'un non-hôte ne peut pas kick');
  ok((await emit(bob, 'closeRoom', {})).ok === false, 'un non-hôte ne peut pas fermer');
  const kicked = once(bob, 'kicked');
  const left = once(alice, 'playerLeft');
  ok((await emit(alice, 'banPlayer', { socketId: bob.id })).ok, 'Alice bannit Bob');
  const kd = await kicked, ld = await left;
  console.log('    debug kicked=', JSON.stringify(kd), 'playerLeft=', JSON.stringify(ld));
  ok(kd?.banned === true, 'Bob reçoit "kicked" (banned)');
  ok(ld?.username === 'Bob', 'Alice reçoit "playerLeft"');
  ok((await emit(bob, 'joinRoom', { roomId: rid, password: 'pw' })).code === 'BANNED', 'Bob banni ne peut plus rejoindre');
  const banList = once(alice, 'roomBans');
  ok((await emit(alice, 'unbanPlayer', { key: 'n:bob' })).ok, 'Alice débannit Bob');
  ok((await banList)?.bans.length === 0, 'liste des bannis vidée (roomBans)');
  ok((await emit(bob, 'joinRoom', { roomId: rid, password: 'pw' })).ok, 'Bob débanni peut rejoindre');
  ok((await emit(chloe, 'joinRoom', { roomId: rid, password: 'pw' })).ok, 'Chloé rejoint');
  const closed = Promise.all([once(bob, 'roomClosed'), once(chloe, 'roomClosed')]);
  ok((await emit(alice, 'closeRoom', {})).ok, 'Alice ferme la room');
  const [c1, c2] = await closed;
  ok(c1?.by === 'Alice' && c2, 'membres notifiés (roomClosed)');
  const list = await emit(mod, 'getRooms');
  ok(list.rooms.length === 0, 'room supprimée de la liste');

  console.log('Transfert d\'hôte');
  const c = await emit(bob, 'createRoom', { name: 'R2' });
  await emit(chloe, 'joinRoom', { roomId: c.room.id });
  const hc = once(chloe, 'hostChanged');
  await emit(bob, 'leaveRoom');
  ok((await hc)?.newHostUsername === 'Chloe', 'hôte transféré à Chloé');

  [mod, alice, bob, chloe].forEach((s) => s.close());
  srv.kill();
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
