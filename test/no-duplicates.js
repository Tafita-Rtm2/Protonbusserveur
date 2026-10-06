/* Anti-doublons : web + jeu = 1 seul joueur (bug 2/10 et 4/10). */
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7872;
let passed = 0, failed = 0;
const ok = (c, m) => { c ? (passed++, console.log('  ✔', m)) : (failed++, console.log('  ✘ FAIL:', m)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 20000).unref();
const emit = (s, ev, p) => new Promise((r) => (p === undefined ? s.emit(ev, r) : s.emit(ev, p, r)));
const conn = async (auth) => { const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], auth }); await new Promise((r) => s.on('connect', r)); return s; };
const count = async (s, id) => (await emit(s, 'getRooms')).rooms?.find((x) => x.id === id)?.playerCount;

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, ADMIN_CODE: 'admin123', REQUIRE_AUTH: 'false' }, stdio: 'ignore', cwd: __dirname + '/..' });
  await wait(1500);
  try {
    console.log('\n--- Création web puis jeu rejoint ---');
    const web = await conn({ client: 'web' });
    const r = await emit(web, 'createRoom', { roomName: 'R1', pseudo: 'Alice' });
    ok(r.ok && r.room.playerCount === 1, 'création => 1 joueur (pas 2)');
    ok(r.room.maxPlayers === 20, 'maxPlayers par défaut = 20');
    const game = await conn();
    const j = await emit(game, 'joinRoom', { roomId: r.room.id, pseudo: 'Alice' });
    ok(j.ok && (await count(game, r.room.id)) === 1, 'le jeu rejoint avec le même pseudo => toujours 1 joueur');
    ok(j.room.hostSocketId === game.id, "l'hôte passe à la connexion du jeu");

    console.log('\n--- Double clic Rejoindre (web) ---');
    const bweb = await conn({ client: 'web' });
    const [a, b] = await Promise.all([emit(bweb, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' }), emit(bweb, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' })]);
    ok(a.ok !== b.ok || (a.ok && b.ok), 'deux clics simultanés : pas de crash');
    ok((await count(bweb, r.room.id)) === 2, 'Bob compté une seule fois (2 joueurs au total)');
    const bgame = await conn();
    await emit(bgame, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' });
    ok((await count(bgame, r.room.id)) === 2, 'le jeu de Bob rejoint => toujours 2 (pas 4)');
    const again = await emit(bweb, 'joinRoom', { roomId: r.room.id, pseudo: 'Bob' });
    ok(again.ok && (await count(bgame, r.room.id)) === 2, 'clic Rejoindre après coup : ignoré, toujours 2');

    console.log('\n--- Deux personnes différentes restent 2 ---');
    const carl = await conn();
    await emit(carl, 'joinRoom', { roomId: r.room.id, pseudo: 'Carl' });
    ok((await count(carl, r.room.id)) === 3, 'Carl (autre pseudo) => 3 joueurs');

    console.log('\n--- Pseudo lisible par le mod (vehicleUpdate) ---');
    const dave = await conn();
    const dj = await emit(dave, 'joinRoom', { roomId: r.room.id, pseudo: '[FR] Jean, Pierre}' });
    ok(dj.ok, 'pseudo avec caractères spéciaux accepté');
    const got = new Promise((res) => carl.once('vehicleUpdate', res));
    await wait(80);
    dave.emit('vehicleUpdate', { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, vehicleId: 'bus_default' });
    const vu = await Promise.race([got, wait(1500).then(() => null)]);
    ok(vu && vu.pseudo === 'FR Jean Pierre' && vu.username === 'FR Jean Pierre', 'vehicleUpdate relayé avec pseudo nettoyé : ' + (vu && vu.pseudo));
    ok(vu && !/[",}\]\[]/.test(vu.pseudo), 'aucun caractère qui casse le parseur du mod');
  } catch (e) { ok(false, 'exception ' + e.message); }
  srv.kill();
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})();
