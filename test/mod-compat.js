/* Non-régression : le mod natif (WebSocket brut, EIO=4, sans token) doit recevoir les MÊMES trames qu'avant. */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { io } = require('socket.io-client');
const PORT = 7865; let p = 0, f = 0;
const ok = (c, m) => { c ? (p++, console.log('  ✔', m)) : (f++, console.log('  ✘ FAIL:', m)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (log) => new Promise((res) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/socket.io/?EIO=4&transport=websocket`);
  ws.on('message', (m) => { m = m.toString(); if (m === '2') return ws.send('3'); if (m.startsWith('0')) return ws.send('40'); log.push(m); if (m.startsWith('40')) res(ws); });
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 30000).unref();
(async () => {
  require('fs').rmSync('/tmp/users.json', { force: true });
  const srv = spawn('node', ['server.js'], { env: { DOTENV_CONFIG_PATH: '/nonexistent', PATH: process.env.PATH, PORT, DATA_DIR: '/tmp' }, stdio: 'ignore', cwd: __dirname + '/..' });
  await wait(1500);

  console.log('Pages du jeu (comme l\'ancien serveur)');
  const root = await fetch(`http://127.0.0.1:${PORT}/`); const html = await root.text();
  ok(root.status === 200 && html.includes('AndroidHost'), '/ sert le menu du jeu (pont Android)');
  const lau = await fetch(`http://127.0.0.1:${PORT}/launcher`);
  ok(lau.status === 200 && (await lau.text()).includes('AndroidHost'), '/launcher sert le menu (au lieu d\'un 404)');
  ok((await fetch(`http://127.0.0.1:${PORT}/api/rooms`)).status === 200, '/api/rooms public comme avant');

  console.log('Trames reçues par le mod');
  const logA = [], logB = [];
  const A = await open(logA), B = await open(logB);           // deux "mods"
  const web = io(`http://127.0.0.1:${PORT}`, { auth: { client: 'web' }, transports: ['websocket'] });  // un site web dans la même room
  await new Promise((r) => web.on('connect', r));
  A.send('421["createRoom",{"roomName":"T","pseudo":"Alice","mapId":"m","busId":"b"}]'); await wait(300);
  const roomId = logA.find((l) => l.startsWith('431'))?.match(/"id":"([^"]+)"/)?.[1];
  ok(!!roomId, 'ack createRoom avec "ok" et "id" (le mod lit l\'id)');
  B.send(`422["joinRoom",{"roomId":"${roomId}","pseudo":"Bob","mapId":"m","busId":"b"}]`); await wait(300);
  await new Promise((r) => web.emit('joinRoom', { roomId }, r));
  web.emit('roomChat', { text: 'playerLeft vehicleUpdate roomState' });       // texte piège pour le parseur du mod
  web.emit('voice:join', {}, () => {}); await wait(400);
  A.send('42["vehicleUpdate",{"position":{"x":1,"y":2,"z":3},"rotation":{"x":0,"y":0,"z":0,"w":1}}]'); await wait(300);

  const names = (log) => log.filter((l) => l.startsWith('42')).map((l) => JSON.parse(l.slice(2))[0]);
  const allowed = new Set(['roomList', 'roomState', 'playerJoined', 'playerLeft', 'vehicleUpdate', 'hostChanged', 'GAME_STARTED', 'gameStarted']);
  const extraA = names(logA).filter((n) => !allowed.has(n)), extraB = names(logB).filter((n) => !allowed.has(n));
  ok(extraA.length === 0 && extraB.length === 0, `aucun événement "site" ne parvient au mod (reçus en trop: ${[...extraA, ...extraB].join(',') || 'aucun'})`);
  ok(!logB.some((l) => l.includes('inVoice') || l.includes('roomMembers') || l.includes('roomChat')), 'aucune trace de inVoice/roomMembers/roomChat côté mod');
  ok(logB.some((l) => l.includes('"roomState"') && l.includes('"players":[{')), 'roomState avec la liste des joueurs');
  ok(logB.some((l) => l.includes('"playerJoined"') ), 'playerJoined reçu');
  ok(logB.filter((l) => l.includes('vehicleUpdate')).length >= 1, 'vehicleUpdate reçu par l\'autre mod');
  B.send('42["voiceState",{"x":1}]'); A.send('421["joinRoom",{"roomId":"' + roomId + '","pseudo":"Alice"}]'); await wait(300);
  ok(logA.some((l) => l.startsWith('431') && l.includes('"ok":true')), 'joinRoom répété (re-émission du mod) : ack ok');
  ok(logA.filter((l) => l.includes('"roomState"')).length >= 2, 'joinRoom répété : roomState renvoyé comme avant');

  [A, B].forEach((w) => w.close()); web.close(); srv.kill();
  console.log(`\n${p} OK, ${f} échec(s)`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
