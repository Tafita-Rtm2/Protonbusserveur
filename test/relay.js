/* Relais allégé : delta, distance, paquets légers, P2P, anti-rafale roomList. */
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7873;
let passed = 0, failed = 0;
const ok = (c, m) => { c ? (passed++, console.log('  ✔', m)) : (failed++, console.log('  ✘ FAIL:', m)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 40000).unref();
const emit = (s, ev, p) => new Promise((r) => (p === undefined ? s.emit(ev, r) : s.emit(ev, p, r)));
const conn = async (auth) => { const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], auth }); await new Promise((r) => s.on('connect', r)); return s; };
const pose = (x, i = 0) => ({ position: { x, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, vehicleId: 'bus_default', busInfo: { busName: 'PBC', busFile: 'pbc', skinPath: 'skins/a.png' }, skinPath: 'skins/a.png' });

// envoie `count` paquets à ~25 Hz ; fn(i) donne la pose
async function stream(sock, count, fn) { for (let i = 0; i < count; i++) { sock.emit('vehicleUpdate', fn(i)); await wait(40); } }

(async () => {
  const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT, ADMIN_CODE: 'admin123', REQUIRE_AUTH: 'false' }, stdio: 'ignore', cwd: __dirname + '/..' });
  await wait(1500);
  try {
    const A = await conn(), B = await conn(), C = await conn();
    const r = await emit(A, 'createRoom', { roomName: 'Relay', pseudo: 'Alpha' });
    ok(r.ok && r.p2p && r.p2p.enabled && Array.isArray(r.p2p.stun), 'createRoom renvoie la config P2P');
    await emit(B, 'joinRoom', { roomId: r.room.id, pseudo: 'Bravo' });
    await emit(C, 'joinRoom', { roomId: r.room.id, pseudo: 'Charlie' });

    const gotB = [], gotC = [];
    B.on('vehicleUpdate', (d) => gotB.push(d));
    C.on('vehicleUpdate', (d) => gotC.push(d));

    console.log('\n--- Premier paquet : complet et compatible ---');
    A.emit('vehicleUpdate', pose(10.123456));
    await wait(200);
    const first = gotB[0];
    ok(first && first.pseudo === 'Alpha' && first.username === 'Alpha' && first.socketId === A.id, 'pseudo/username/socketId présents (noms affichés)');
    ok(first && first.busInfo && first.busInfo.busFile === 'pbc' && first.skinPath === 'skins/a.png', 'busInfo + skinPath envoyés au premier contact');
    ok(first && first.position.x === 10.12, 'position arrondie au cm');
    ok(first && first.transform === undefined && first.controls === undefined, 'plus de champs dupliqués (transform/controls)');
    ok(first && first.headlight === false && first.reverse === false, 'valeurs par défaut des feux');

    console.log('\n--- Paquets légers ensuite ---');
    gotB.length = 0;
    await stream(A, 10, (i) => pose(11 + i));
    ok(gotB.length >= 7, `bus qui roule : ${gotB.length} paquets reçus sur 10 envoyés`);
    ok(gotB.slice(1).every((d) => d.busInfo === undefined && d.pseudo === 'Alpha'), 'paquets suivants sans busInfo mais avec le pseudo');

    console.log('\n--- Bus immobile : quasi rien envoyé ---');
    gotB.length = 0; gotC.length = 0;
    await stream(A, 75, () => pose(50));  // 3 s à 25 Hz, position fixe
    ok(gotB.length <= 5, `75 paquets immobiles => ${gotB.length} reçus (keep-alive 1/s)`);
    ok(gotB.length >= 2, 'keep-alive présent (le bus ne disparaît pas)');

    console.log('\n--- Distance : le lointain reçoit moins ---');
    C.emit('vehicleUpdate', pose(6000));         // C est à 6 km
    await wait(100);
    gotB.length = 0; gotC.length = 0;
    await stream(A, 50, (i) => pose(100 + i));   // 2 s de mouvement
    ok(gotB.length >= 35, `joueur proche (B) : ${gotB.length} paquets`);
    ok(gotC.length <= 6, `joueur à 6 km (C) : ${gotC.length} paquets (réduit)`);
    ok(gotC.length >= 1, 'le lointain reçoit quand même des mises à jour');

    console.log('\n--- Nouveau joueur : reçoit busInfo tout de suite ---');
    const D = await conn();
    await emit(D, 'joinRoom', { roomId: r.room.id, pseudo: 'Delta' });
    const gotD = [];
    D.on('vehicleUpdate', (d) => gotD.push(d));
    await stream(A, 5, (i) => pose(200 + i));
    ok(gotD.length > 0 && gotD[0].busInfo && gotD[0].pseudo === 'Alpha', 'Delta reçoit pseudo + busInfo dès le 1er paquet');

    console.log('\n--- P2P : liaison déclarée des deux côtés ---');
    const ann = await emit(A, 'p2p:announce', { endpoints: [{ ip: '1.2.3.4', port: 50000 }], nat: 'cone' });
    ok(ann.ok && ann.p2p && ann.p2p.udpPort === 8999, 'p2p:announce OK');
    let sig = null; B.on('p2p:signal', (m) => { sig = m; });
    A.emit('p2p:signal', { to: B.id, data: { t: 'punch', n: 1 } });
    await wait(150);
    ok(sig && sig.from === A.id && sig.data.t === 'punch', 'p2p:signal relayé entre joueurs du même salon');
    A.emit('p2p:links', { peers: [B.id] });
    B.emit('p2p:links', { peers: [A.id] });
    await wait(100);
    gotB.length = 0; gotC.length = 0;
    const gotD2 = []; D.removeAllListeners('vehicleUpdate'); D.on('vehicleUpdate', (d) => gotD2.push(d));
    await stream(A, 50, (i) => pose(300 + i));
    ok(gotB.length <= 3, `liaison A<->B : B ne reçoit presque plus rien du serveur (${gotB.length})`);
    ok(gotD2.length >= 35, `D (sans P2P) continue d'être servi normalement (${gotD2.length})`);

    console.log('\n--- Plusieurs expéditeurs en même temps : aucun paquet perdu ---');
    const rcv = new Map(); const E = await conn(); await emit(E, 'joinRoom', { roomId: r.room.id, pseudo: 'Echo' });
    E.on('vehicleUpdate', (d) => rcv.set(d.pseudo, (rcv.get(d.pseudo) || 0) + 1));
    const senders = [A, B, C, D];
    for (let i = 0; i < 40; i++) { senders.forEach((s, k) => s.emit('vehicleUpdate', pose(500 + k * 5 + i))); await wait(40); }
    await wait(200);
    ['Alpha', 'Bravo', 'Delta'].forEach((n) => ok((rcv.get(n) || 0) >= 30, `Echo reçoit ${n} : ${rcv.get(n) || 0}/40`));

    console.log('\n--- Anti-rafale roomList ---');
    const obs = await conn();
    let lists = 0; await wait(300); obs.on('roomList', () => { lists++; });
    const makers = await Promise.all(Array.from({ length: 6 }, () => conn()));
    await Promise.all(makers.map((m, i) => emit(m, 'createRoom', { roomName: 'R' + i, pseudo: 'P' + i })));
    await wait(500);
    ok(lists >= 1 && lists <= 2, `6 créations quasi simultanées => ${lists} envoi(s) de roomList`);
  } catch (e) { ok(false, 'exception ' + e.message); }
  srv.kill();
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})();
