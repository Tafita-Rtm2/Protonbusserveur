const http = require('http');
const { io } = require('socket.io-client');
const assert = require('assert');

// Port de test
const PORT = 7861;
process.env.PORT = PORT;

// Charger le serveur
require('./server.js');

const BASE_URL = `http://localhost:${PORT}`;

function makeHttpRequest(path, method, body, forceInvalidHeader = false) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'object' ? JSON.stringify(body) : String(body || '');
    const options = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: {
        'Content-Type': forceInvalidHeader ? 'text/plain' : 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      let responseText = '';
      res.on('data', (chunk) => (responseText += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(responseText);
          resolve({ status: res.statusCode, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, text: responseText });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Début des tests du serveur Proton Bus...');

  // 1. Test Express JSON Error Handling
  console.log('--- Test 1: Middleware de gestion des erreurs JSON ---');
  const errRes = await makeHttpRequest('/api/register', 'POST', 'not json string', false);
  console.log('Réponse JSON mal formé:', errRes);
  assert.strictEqual(errRes.status, 400);
  assert.strictEqual(errRes.body.error, 'Format JSON invalide');
  console.log('✅ Test 1 Réussi !');

  // 2. Test Auth Register & Login with username
  console.log('--- Test 2: Inscription et Connexion REST API (username) ---');
  const testUsername = `DriverTana_${Date.now().toString(36)}`;
  const regRes = await makeHttpRequest('/api/register', 'POST', {
    username: testUsername,
    password: 'superpassword123',
  });
  console.log('Register Res:', regRes);
  assert.strictEqual(regRes.status, 201);
  assert.strictEqual(regRes.body.user.username, testUsername);
  assert.ok(regRes.body.token);

  const loginRes = await makeHttpRequest('/api/login', 'POST', {
    username: testUsername,
    password: 'superpassword123',
  });
  console.log('Login Res:', loginRes);
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginRes.body.user.username, testUsername);
  assert.ok(loginRes.body.token);
  console.log('✅ Test 2 Réussi !');

  // 3. Test Socket.io (Rooms, Auth, Start Game, Vehicle Sync, Host Change)
  console.log('--- Test 3: Socket.io - Rooms, Start Game, Sync & Host Change ---');

  const client1 = io(BASE_URL, {
    transports: ['websocket'],
    auth: { token: loginRes.body.token },
  });

  const client2 = io(BASE_URL, {
    transports: ['websocket'],
  });

  await new Promise((resolve) => client1.on('connect', resolve));
  await new Promise((resolve) => client2.on('connect', resolve));

  console.log(`Client 1 connecté (${client1.id}), Client 2 connecté (${client2.id})`);

  // Client 1 crée une room privée
  let createdRoom;
  await new Promise((resolve, reject) => {
    client1.emit(
      'createRoom',
      {
        roomName: 'Salon Privé Antananarivo',
        isPrivate: true,
        password: 'pass123',
        mapId: 'map_tana',
        busId: 'bus_tana',
        username: 'DriverTana',
      },
      (res) => {
        if (!res.ok) return reject(new Error(res.error));
        createdRoom = res.room;
        resolve();
      }
    );
  });

  assert.strictEqual(createdRoom.roomName, 'Salon Privé Antananarivo');
  assert.strictEqual(createdRoom.isPrivate, true);
  assert.strictEqual(createdRoom.hostId, client1.id);
  console.log('Room créée avec succès:', createdRoom);

  // Client 2 appelle getRooms
  const getRoomsRes = await new Promise((resolve) => {
    client2.emit('getRooms', (res) => resolve(res));
  });
  console.log('getRooms Res:', getRoomsRes);
  assert.strictEqual(getRoomsRes.ok, true);
  assert.strictEqual(getRoomsRes.rooms.length, 1);
  assert.strictEqual(getRoomsRes.rooms[0].isPrivate, true);
  assert.strictEqual(getRoomsRes.rooms[0].passwordHash, undefined); // ne doit pas exposer le pass

  // Client 2 rejoint la room
  await new Promise((resolve, reject) => {
    client2.emit(
      'joinRoom',
      {
        roomId: createdRoom.id,
        password: 'pass123',
        mapId: 'map_tana',
        username: 'Joueur2',
      },
      (res) => {
        if (!res.ok) return reject(new Error(res.error));
        resolve();
      }
    );
  });
  console.log('Client 2 a rejoint la room !');

  // Client 2 (non-hôte) tente startGame -> doit échouer
  const nonHostStart = await new Promise((resolve) => {
    client2.emit('startGame', { mapId: 'map_tana' }, resolve);
  });
  assert.strictEqual(nonHostStart.ok, false);
  console.log('Tentative non-hôte rejetée comme prévu:', nonHostStart.error);

  // Écoute des événements GAME_STARTED
  const pGameStarted1 = new Promise((resolve) => client1.once('GAME_STARTED', resolve));
  const pGameStarted2 = new Promise((resolve) => client2.once('GAME_STARTED', resolve));

  // Client 1 (hôte) émet startGame -> doit réussir
  const hostStart = await new Promise((resolve) => {
    client1.emit('startGame', { mapId: 'map_tana' }, resolve);
  });
  assert.strictEqual(hostStart.ok, true);
  console.log('Hôte a démarré la partie !');

  const gameStartedEvt1 = await pGameStarted1;
  const gameStartedEvt2 = await pGameStarted2;
  assert.strictEqual(gameStartedEvt1.mapId, 'map_tana');
  assert.strictEqual(gameStartedEvt2.mapId, 'map_tana');
  console.log('Événement GAME_STARTED reçu par tous les joueurs !');

  // Test Sync Véhicule (client 2 envoie, client 1 reçoit)
  const pVehicleUpdate = new Promise((resolve) => client1.once('vehicleUpdate', resolve));

  client2.emit('vehicleUpdate', {
    position: { x: 10.5, y: 1.2, z: -5.0 },
    rotation: { x: 0, y: 0.707, z: 0, w: 0.707 },
    controls: {
      steerInput: 0.5,
      throttle: 0.8,
      brake: 0,
      handbrake: 0,
    },
  });

  const syncData = await pVehicleUpdate;
  console.log('Données vehicleUpdate reçues par Client 1:', syncData);
  assert.strictEqual(syncData.username, 'Joueur2');
  assert.strictEqual(syncData.position.x, 10.5);
  assert.strictEqual(syncData.controls.steerInput, 0.5);
  assert.strictEqual(syncData.controls.throttle, 0.8);
  console.log('✅ Synchronisation véhicule 30Hz vérifiée !');

  // Test Transfert Hôte (Client 1 quitte la room, Client 2 doit devenir Hôte)
  const pHostChanged = new Promise((resolve) => client2.once('hostChanged', resolve));
  client1.emit('leaveRoom');

  const hostChangeData = await pHostChanged;
  console.log('Événement hostChanged reçu par Client 2:', hostChangeData);
  assert.strictEqual(hostChangeData.newHostId, client2.id);
  assert.strictEqual(hostChangeData.newHostUsername, 'Joueur2');
  console.log('✅ Transfert d\'hôte réussi !');

  client1.disconnect();
  client2.disconnect();

  console.log('🎉 TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS !');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Échec d\'un test:', err);
  process.exit(1);
});
