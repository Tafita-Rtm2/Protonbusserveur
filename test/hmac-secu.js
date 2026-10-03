/**
 * Test de sécurité HMAC-SHA256 & Durcissement Niveau 3
 */

const crypto = require('crypto');

const HMAC_SHARED_SECRET = process.env.HMAC_SHARED_SECRET || 'test_secret_key_for_unit_tests_123456';

function computeHmac(eventType, payload) {
  const ts = payload.timestamp;
  let canonicalStr = '';

  if (eventType === 'createRoom') {
    const roomName = payload.roomName ?? payload.name ?? '';
    const mapId = payload.mapId ?? '';
    const busId = payload.busId ?? '';
    const pseudo = payload.pseudo ?? payload.username ?? '';
    canonicalStr = `${roomName}|${mapId}|${busId}|${pseudo}|${ts}`;
  } else if (eventType === 'joinRoom') {
    const roomId = payload.roomId ?? '';
    const pseudo = payload.pseudo ?? payload.username ?? '';
    canonicalStr = `${roomId}|${pseudo}|${ts}`;
  } else if (eventType === 'vehicleUpdate') {
    const roomId = payload.roomId ?? '';
    const x = payload.x ?? payload.position?.x ?? 0;
    const y = payload.y ?? payload.position?.y ?? 0;
    const z = payload.z ?? payload.position?.z ?? 0;
    const rotX = payload.rotX ?? payload.rotation?.x ?? 0;
    const rotY = payload.rotY ?? payload.rotation?.y ?? 0;
    const rotZ = payload.rotZ ?? payload.rotation?.z ?? 0;
    const rotW = payload.rotW ?? payload.rotation?.w ?? 1;
    canonicalStr = `${roomId}|${x}|${y}|${z}|${rotX}|${rotY}|${rotZ}|${rotW}|${ts}`;
  }

  return crypto
    .createHmac('sha256', HMAC_SHARED_SECRET)
    .update(canonicalStr)
    .digest('hex')
    .toLowerCase();
}

async function runHmacTests() {
  console.log('\n--- Test Sécurité HMAC & Hardening Niveau 3 ---');

  process.env.REQUIRE_HMAC_SIG = 'false';
  process.env.HMAC_SHARED_SECRET = HMAC_SHARED_SECRET;

  const { io: clientIo } = require('socket.io-client');
  const serverJs = require('../server');

  await new Promise((r) => setTimeout(r, 500));

  const PORT = process.env.PORT || 7860;
  const SERVER_URL = `http://127.0.0.1:${PORT}`;

  const socketOptions = {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
  };

  const client = clientIo(SERVER_URL, socketOptions);

  await new Promise((resolve) => {
    client.on('connect', resolve);
  });
  console.log('  ✔ Client socket connecté pour tests HMAC');

  // 1. createRoom avec signature HMAC valide
  const nowTs = Math.floor(Date.now() / 1000);
  const createPayload = {
    roomName: 'SalonHMAC',
    mapId: 'map_tana',
    busId: 'bus_01',
    pseudo: 'TesteurHMAC',
    timestamp: nowTs,
  };
  createPayload.sig = computeHmac('createRoom', createPayload);

  const resCreate = await new Promise((resolve) => {
    client.emit('createRoom', createPayload, resolve);
  });

  if (resCreate && resCreate.ok && resCreate.room) {
    console.log('  ✔ createRoom avec signature HMAC valide : OK');
  } else {
    console.error('  ❌ createRoom avec signature HMAC valide échoué:', resCreate);
    process.exit(1);
  }

  const roomId = resCreate.room.id;

  // 2. joinRoom avec signature HMAC valide
  const client2 = clientIo(SERVER_URL, socketOptions);
  await new Promise((resolve) => client2.on('connect', resolve));

  const joinPayload = {
    roomId,
    pseudo: 'Joueur2HMAC',
    timestamp: Math.floor(Date.now() / 1000),
  };
  joinPayload.sig = computeHmac('joinRoom', joinPayload);

  const resJoin = await new Promise((resolve) => {
    client2.emit('joinRoom', joinPayload, resolve);
  });

  if (resJoin && resJoin.ok) {
    console.log('  ✔ joinRoom avec signature HMAC valide : OK');
  } else {
    console.error('  ❌ joinRoom avec signature HMAC valide échoué:', resJoin);
    process.exit(1);
  }

  // 3. vehicleUpdate avec signature HMAC valide
  const vPayload = {
    roomId,
    x: 10.5,
    y: 1.2,
    z: 300.4,
    rotX: 0,
    rotY: 0.707,
    rotZ: 0,
    rotW: 0.707,
    timestamp: Math.floor(Date.now() / 1000),
  };
  vPayload.sig = computeHmac('vehicleUpdate', vPayload);

  const vUpdatePromise = new Promise((resolve) => {
    client2.on('vehicleUpdate', (data) => {
      if (data.roomId === roomId) resolve(data);
    });
  });

  client.emit('vehicleUpdate', vPayload);
  const vReceived = await Promise.race([
    vUpdatePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout vehicleUpdate')), 2000)),
  ]);

  if (vReceived && vReceived.roomId === roomId) {
    console.log('  ✔ vehicleUpdate avec signature HMAC valide relayé : OK');
  } else {
    console.error('  ❌ vehicleUpdate avec signature HMAC valide non reçu');
    process.exit(1);
  }

  // 4. Test d'horodatage expiré (>15 secondes)
  const expiredPayload = {
    roomName: 'SalonExpire',
    timestamp: nowTs - 100, // 100 secondes dans le passé
  };
  expiredPayload.sig = computeHmac('createRoom', expiredPayload);

  // En mode transition (REQUIRE_HMAC_SIG=false), accepté avec warning
  const resExpiredTransition = await new Promise((resolve) => client.emit('createRoom', expiredPayload, resolve));
  if (resExpiredTransition && resExpiredTransition.ok) {
    console.log('  ✔ Mode transition (REQUIRE_HMAC_SIG=false) : avertissement loggé sans bloquer');
  } else {
    console.error('  ❌ Mode transition a bloqué alors qu\'il ne devait pas:', resExpiredTransition);
    process.exit(1);
  }

  // 5. Test Rate Limit création de salons (> 5 salons par minute)
  const clientLimit = clientIo(SERVER_URL, socketOptions);
  await new Promise((resolve) => clientLimit.on('connect', resolve));

  let rateLimited = false;
  for (let i = 0; i < 10; i++) {
    const p = { roomName: `SalonLimit_${i}`, timestamp: Math.floor(Date.now() / 1000) };
    p.sig = computeHmac('createRoom', p);
    const r = await new Promise((resolve) => clientLimit.emit('createRoom', p, resolve));
    if (!r.ok && r.error && r.error.includes('Trop de tentatives')) {
      rateLimited = true;
      break;
    }
  }

  if (rateLimited) {
    console.log('  ✔ Limitation du débit de création de salons (Niveau 3) : OK');
  } else {
    console.error('  ❌ La limitation de création de salons n\'a pas été déclenchée');
    process.exit(1);
  }

  client.disconnect();
  client2.disconnect();
  clientLimit.disconnect();

  console.log('✔ Tous les tests HMAC & Sécurité ont réussi !');
  process.exit(0);
}

runHmacTests().catch((err) => {
  console.error('❌ Erreur test HMAC:', err);
  process.exit(1);
});
