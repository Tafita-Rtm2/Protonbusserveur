/* Tests automatisés pour les nouvelles fonctionnalités ProtonBusSync :
   - Migration d'hôte (roomHostChanged + hostChanged)
   - Validation des clés d'activation (INVALID_KEY)
   - Relais de l'éclairage/clignotants et skinPath dans vehicleUpdate, playerJoined, roomState
*/

const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const http = require('http');

const PORT = 7868;
let passed = 0, failed = 0;
const ok = (cond, msg) => { cond ? (passed++, console.log('  ✔', msg)) : (failed++, console.log('  ✘ FAIL:', msg)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => {
  console.error('TIMEOUT: Les tests ont pris trop de temps.');
  process.exit(2);
}, 30000).unref();

function apiPost(path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => buf += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const srv = spawn('node', ['server.js'], {
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: '/nonexistent',
      PORT,
      ADMIN_CODE: 'admin123',
      API_PROXY_KEY: 'testproxykey',
      REQUIRE_AUTH: 'false',
    },
    stdio: 'ignore',
    cwd: __dirname + '/..',
  });

  await wait(1500);

  console.log('\n--- Test 1: Validation de la Clé d\'Activation ---');
  // Générer une vraie clé d'activation via l'API Admin
  const adminLogin = await apiPost('/api/admin/login', { 'x-proxy-key': 'testproxykey' }, { adminCode: 'admin123' });
  const adminToken = adminLogin.body.token;

  const genKeyRes = await apiPost('/api/admin/keys/generate', {
    'x-proxy-key': 'testproxykey',
    'Authorization': `Bearer ${adminToken}`,
  }, { playerName: 'ChauffeurPro', duration: '1h' });

  const validKey = genKeyRes.body.key.keyCode;
  ok(!!validKey, 'Clé générée via API Admin');

  const sockA = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => sockA.on('connect', r));

  // Tenter de créer un salon avec une clé invalide
  const badKeyRes = await new Promise((r) => sockA.emit('createRoom', { roomName: 'TestBadKey', activationKey: 'KEY-0000-0000-0000' }, r));
  ok(badKeyRes.ok === false && badKeyRes.code === 'INVALID_KEY', 'createRoom refusé pour clé invalide (code INVALID_KEY)');

  // Tenter de rejeter joinRoom avec une clé invalide
  const badJoinRes = await new Promise((r) => sockA.emit('joinRoom', { roomId: 'nonexistent', activationKey: 'KEY-0000-0000-0000' }, r));
  ok(badJoinRes.ok === false && badJoinRes.code === 'INVALID_KEY', 'joinRoom refusé pour clé invalide (code INVALID_KEY)');

  // Créer un salon avec une clé valide
  const goodRoomRes = await new Promise((r) => sockA.emit('createRoom', { roomName: 'TestGoodKey', activationKey: validKey, pseudo: 'ChauffeurPro' }, r));
  ok(goodRoomRes.ok === true && goodRoomRes.room?.id, 'createRoom accepté avec clé d\'activation valide');

  const sockA2 = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => sockA2.on('connect', r));
  const activeKeyRes = await new Promise((r) => sockA2.emit('createRoom', { roomName: 'TestActiveKey', activationKey: validKey, pseudo: 'ChauffeurPro2' }, r));
  ok(activeKeyRes.ok === false && activeKeyRes.code === 'KEY_ALREADY_ACTIVE', 'Clé déjà active sur un autre socket refusée');
  sockA2.close();

  console.log('\n--- Test 2: Migration d\'Hôte & Événements Alignés ---');
  const sockB = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => sockB.on('connect', r));

  const joinResB = await new Promise((r) => sockB.emit('joinRoom', { roomId: goodRoomRes.room.id, pseudo: 'Bob' }, r));
  ok(joinResB.ok === true, 'Joueur B rejoint le salon');

  let roomHostChangedReceived = null;
  let hostChangedReceived = null;

  sockB.on('roomHostChanged', (data) => { roomHostChangedReceived = data; });
  sockB.on('hostChanged', (data) => { hostChangedReceived = data; });

  // Déconnecter l'hôte sockA
  sockA.disconnect();
  await wait(500);

  ok(!!roomHostChangedReceived && roomHostChangedReceived.newHostSocketId === sockB.id, 'Événement roomHostChanged émis vers le nouvel hôte');
  ok(!!hostChangedReceived && hostChangedReceived.newHostId === sockB.id, 'Événement hostChanged (compatibilité) également émis');

  console.log('\n--- Test 3: Synchronisation des Lumières & skinPath ---');
  const sockC = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'] });
  await new Promise((r) => sockC.on('connect', r));

  let playerJoinedData = null;
  let vehicleUpdateData = null;

  sockC.on('playerJoined', (data) => { playerJoinedData = data; });
  sockC.on('vehicleUpdate', (data) => { vehicleUpdateData = data; });

  const joinResC = await new Promise((r) => sockC.emit('joinRoom', {
    roomId: goodRoomRes.room.id,
    pseudo: 'Charlie',
    skinPath: 'Skins/Vehicles/Bus_Tana.png',
  }, r));

  ok(joinResC.ok === true, 'Joueur C rejoint avec skinPath');

  // SockB envoie vehicleUpdate sans feux (ancienne APK)
  sockB.emit('vehicleUpdate', {
    position: { x: 10, y: 0, z: 20 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    skinPath: 'Skins/Vehicles/Bob_Bus.png',
  });

  await wait(300);

  ok(!!vehicleUpdateData, 'vehicleUpdate reçu par Joueur C');
  ok(vehicleUpdateData?.headlight === false &&
     vehicleUpdateData?.turnLeft === false &&
     vehicleUpdateData?.turnRight === false &&
     vehicleUpdateData?.hazard === false &&
     vehicleUpdateData?.brake === false &&
     vehicleUpdateData?.reverse === false, 'Valeurs par défaut (false) appliquées pour les feux manquants');
  ok(vehicleUpdateData?.skinPath === 'Skins/Vehicles/Bob_Bus.png', 'skinPath relayé avec succès');

  // SockB envoie vehicleUpdate avec feux actifs
  vehicleUpdateData = null;
  sockB.emit('vehicleUpdate', {
    position: { x: 10, y: 0, z: 21 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    headlight: true,
    turnLeft: true,
    hazard: true,
  });

  await wait(300);

  ok(vehicleUpdateData?.headlight === true &&
     vehicleUpdateData?.turnLeft === true &&
     vehicleUpdateData?.hazard === true &&
     vehicleUpdateData?.turnRight === false, 'Feux spécifiques (headlight, turnLeft, hazard) correctement relayés');

  sockB.close();
  sockC.close();
  srv.kill();

  console.log(`\nResultats: ${passed} OK, ${failed} echec(s)`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Erreur test features:', err);
  process.exit(1);
});
