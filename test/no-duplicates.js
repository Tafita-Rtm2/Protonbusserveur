/* Anti-doublons : un joueur ne doit jamais compter 2 fois (bug 2/10, 4/10). */
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7871;
let passed = 0, failed = 0;
const ok = (c, m) => { c ? (passed++, console.log('  ✔', m)) : (failed++, console.log('  ✘ FAIL:', m)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 20000).unref();
const emit = (s, ev, p) => new Promise((r) => (p === undefined ? s.emit(ev, r) : s.emit(ev, p, r)));
const conn = async () => { const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] }); await new Promise((r) => s.on('connect', r)); return s; };

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent', PORT, ADMIN_CODE: 'admin123', API_PROXY_KEY: 'k', REQUIRE_AUTH: 'false' }, stdio: 'ignore', cwd: __dirname + '/..' });
  await wait(1500);

  console.log('\n--- Création : 1/20 et non 2/10 ---');
  const a = await conn();
  const r = await emit(a, 'createRoom', { roomName: 'R1', pseudo: 'Alice' });
  ok(r.ok && r.room.playerCount === 1, 'création => playerCount = 1');
  ok(r.room.maxPlayers === 20, 'maxPlayers par défaut = 20');

  console.log('\n--- Double clic Rejoindre (même socket) ---');
  const b = await conn();
  const [j1, j2] = await Promise.all([emit(b, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' }), emit(b, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' })]);
  const rooms = await emit(b, 'getRooms');
  ok(rooms.rooms.find((x) => x.id === r.room.id).playerCount === 2, 'double clic => 2 joueurs (Alice + Bob), pas 3/4');

  console.log('\n--- 2e connexion du même joueur (même pseudo/IP) ---');
  const b2 = await conn();
  let dup = false; b.on('duplicateSession', () => { dup = true; });
  const j3 = await emit(b2, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' });
  const rooms2 = await emit(b2, 'getRooms');
  ok(j3.ok && rooms2.rooms.find((x) => x.id === r.room.id).playerCount === 2, 'reconnexion de Bob => toujours 2 joueurs');
  await wait(200);
  ok(dup, "l'ancienne session reçoit duplicateSession");

  console.log('\n--- Hôte qui se reconnecte garde son salon ---');
  const a2 = await conn();
  const j4 = await emit(a2, 'joinRoom', { roomId: r.room.id, pseudo: 'Alice' });
  ok(j4.ok && j4.room.hostSocketId === a2.id, "Alice reconnectée récupère l'hôte");
  ok(j4.room.playerCount === 2, 'toujours 2 joueurs');

  srv.kill();
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})();
