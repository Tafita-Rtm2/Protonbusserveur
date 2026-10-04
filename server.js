/**
 * Proton Bus Simulator - Serveur Multijoueur avec Clés d'Accès
 * -----------------------------------------------------------
 * Express (API REST) + Socket.io (temps réel) — Hugging Face / Docker / Vercel.
 */

try { require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || undefined, quiet: true }); } catch (e) {}

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./db');

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------
const PORT = process.env.PORT || 7860;
const TICK_RATE = 30;
const MIN_TICK_INTERVAL_MS = 1000 / TICK_RATE;
const DEFAULT_MAX_PLAYERS = 10;
const JWT_EXPIRES_IN = '7d';

const ADMIN_CODE = process.env.ADMIN_CODE;

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[SECURITE] ⚠️ JWT_SECRET absent : clé aléatoire générée.');
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || '').toLowerCase() === 'true';
const HMAC_SHARED_SECRET = process.env.HMAC_SHARED_SECRET || '';
const REQUIRE_HMAC_SIG = String(process.env.REQUIRE_HMAC_SIG || '').toLowerCase() === 'true';

if (!HMAC_SHARED_SECRET) {
  console.warn('[Secu] ⚠️ HMAC_SHARED_SECRET non défini dans l\'environnement.');
}

const API_PROXY_KEY = process.env.API_PROXY_KEY || '';
const SOCKET_PATH = '/socket.io';
const ENABLE_DASHBOARD = String(process.env.ENABLE_DASHBOARD || 'true').toLowerCase() !== 'false';

let ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
try {
  if (process.env.ICE_SERVERS) ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS);
} catch (e) {}

function originCheck(origin, cb) {
  if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) {
    return cb(null, true);
  }
  return cb(null, false);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ------------------------------------------------------------------
// Sécurité : Throttled Logging & Vérification HMAC
// ------------------------------------------------------------------
const secuLogHistory = new Map();
function logSecuThrottled(key, message, intervalMs = 5000) {
  const now = Date.now();
  const last = secuLogHistory.get(key) || 0;
  if (now - last > intervalMs) {
    secuLogHistory.set(key, now);
    console.warn(`[Secu] ${message}`);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of secuLogHistory.entries()) {
    if (now - ts > 60000) secuLogHistory.delete(k);
  }
}, 60000).unref();

function verifyHmacSignature(eventType, payload, defaultRoomId = '') {
  if (!HMAC_SHARED_SECRET) {
    return { ok: false, reason: 'NO_SECRET_CONFIGURED' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, reason: 'PAYLOAD_INVALID' };
  }

  const { timestamp, sig } = payload;
  if (sig === undefined || sig === null || timestamp === undefined || timestamp === null) {
    return { ok: false, reason: 'MISSING_SIG_OR_TIMESTAMP' };
  }

  const tsNum = Number(timestamp);
  if (isNaN(tsNum)) {
    return { ok: false, reason: 'INVALID_TIMESTAMP_FORMAT' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > 15) {
    return { ok: false, reason: `TIMESTAMP_OUT_OF_BOUNDS (diff: ${Math.abs(nowSec - tsNum)}s)` };
  }

  let canonicalStr = '';
  if (eventType === 'createRoom') {
    const roomName = payload.roomName ?? payload.name ?? '';
    const mapId = payload.mapId ?? '';
    const busId = payload.busId ?? '';
    const pseudo = payload.pseudo ?? payload.username ?? '';
    canonicalStr = `${roomName}|${mapId}|${busId}|${pseudo}|${tsNum}`;
  } else if (eventType === 'joinRoom') {
    const roomId = payload.roomId ?? defaultRoomId ?? '';
    const pseudo = payload.pseudo ?? payload.username ?? '';
    canonicalStr = `${roomId}|${pseudo}|${tsNum}`;
  } else if (eventType === 'vehicleUpdate') {
    // IMPORTANT : le client C++ signe les nombres formatés en texte fixe
    // à 4 décimales ("%.4f", ex: "5.1000"). Le JSON ne conserve jamais les
    // zéros de fin ({"x":5.1000} -> nombre JS 5.1), donc un simple ${x}
    // ici donnerait "5.1" et ferait échouer la vérification à chaque fois.
    // On doit reformater chaque nombre en 4 décimales fixes pour retomber
    // exactement sur la même chaîne que celle signée côté jeu.
    const fixed4 = (v) => Number(v ?? 0).toFixed(4);
    const roomId = payload.roomId ?? defaultRoomId ?? '';
    const x = fixed4(payload.x ?? payload.position?.x);
    const y = fixed4(payload.y ?? payload.position?.y);
    const z = fixed4(payload.z ?? payload.position?.z);
    const rotX = fixed4(payload.rotX ?? payload.rotation?.x);
    const rotY = fixed4(payload.rotY ?? payload.rotation?.y);
    const rotZ = fixed4(payload.rotZ ?? payload.rotation?.z);
    const rotW = fixed4(payload.rotW ?? payload.rotation?.w ?? 1);
    canonicalStr = `${roomId}|${x}|${y}|${z}|${rotX}|${rotY}|${rotZ}|${rotW}|${tsNum}`;
  } else {
    return { ok: false, reason: 'UNKNOWN_EVENT_TYPE' };
  }

  const expectedSig = crypto
    .createHmac('sha256', HMAC_SHARED_SECRET)
    .update(canonicalStr)
    .digest('hex')
    .toLowerCase();

  const receivedSig = String(sig).trim().toLowerCase();

  const bufExpected = Buffer.from(expectedSig);
  const bufReceived = Buffer.from(receivedSig);

  if (bufExpected.length !== bufReceived.length || !crypto.timingSafeEqual(bufExpected, bufReceived)) {
    return { ok: false, reason: 'SIGNATURE_MISMATCH', canonicalStr, expectedSig, receivedSig };
  }

  return { ok: true };
}

// Rate Limiting & Validation Niveau 3
const roomCreationRateLimit = new Map();
function checkRoomCreationLimit(key, maxPerMinute = 5) {
  const now = Date.now();
  let history = roomCreationRateLimit.get(key) || [];
  history = history.filter((ts) => now - ts < 60000);
  if (history.length >= maxPerMinute) {
    return false;
  }
  history.push(now);
  roomCreationRateLimit.set(key, history);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, history] of roomCreationRateLimit.entries()) {
    const filtered = history.filter((ts) => now - ts < 60000);
    if (filtered.length === 0) roomCreationRateLimit.delete(key);
    else roomCreationRateLimit.set(key, filtered);
  }
}, 60000).unref();

function checkVehicleUpdateRateLimit(socket) {
  const now = Date.now();
  if (!socket.data.updateRateHistory) {
    socket.data.updateRateHistory = { windowStart: now, count: 0 };
  }
  const history = socket.data.updateRateHistory;
  if (now - history.windowStart > 1000) {
    history.windowStart = now;
    history.count = 1;
    return true;
  }
  history.count += 1;
  if (history.count > 35) {
    return false;
  }
  return true;
}

function validatePayloadSize(payload, maxKeys = 30, maxStringLen = 500) {
  if (!payload || typeof payload !== 'object') return false;
  const keys = Object.keys(payload);
  if (keys.length > maxKeys) return false;
  for (const k of keys) {
    const val = payload[k];
    if (typeof val === 'string' && val.length > maxStringLen) return false;
  }
  return true;
}

// ------------------------------------------------------------------
// Données en mémoire : rooms & sessions actives
// ------------------------------------------------------------------
/** @type {Map<string, any>} */
const rooms = new Map();

/** Option A : keyCode -> socketId */
const activeSessions = new Map();

const userKey = (name) => String(name || '').trim().toLowerCase();
const genId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

function generateAccessKeyString() {
  const buf = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `KEY-${buf.slice(0, 4)}-${buf.slice(4, 8)}-${buf.slice(8, 12)}`;
}

function publicRoom(room) {
  const hostPlayer = room.players.get(room.hostId);
  const hostUsername = hostPlayer ? (hostPlayer.username || hostPlayer.pseudo) : '';
  return {
    id: room.id,
    name: room.name,
    roomName: room.name,
    isPrivate: room.isPrivate || !!room.passwordHash,
    hasPassword: !!room.passwordHash,
    mapId: room.mapId,
    busId: room.busId,
    maxPlayers: room.maxPlayers,
    playerCount: room.players.size,
    hostId: room.hostId,
    hostUsername,
    players: Array.from(room.players.values()).map((p) => p.username || p.pseudo),
    createdAt: room.createdAt,
  };
}
const publicRoomList = () => Array.from(rooms.values()).map(publicRoom);

const BUS_INFO_KEYS = ['busName', 'busEntry', 'busModType', 'busFile', 'busDir', 'busObj', 'skinBus', 'skinTex', 'skinPath'];
function cleanBusInfo(bi) {
  if (!bi || typeof bi !== 'object') return null;
  const out = {};
  for (const k of BUS_INFO_KEYS) {
    if (bi[k] !== undefined && bi[k] !== null) out[k] = String(bi[k]).slice(0, 160);
  }
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------
// Express & Socket.io
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: originCheck }));
app.use(express.json({ limit: '10kb' }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Format JSON invalide' });
  }
  next(err);
});

const server = http.createServer(app);
const io = new Server(server, {
  path: SOCKET_PATH,
  cors: { origin: originCheck, methods: ['GET', 'POST'] },
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e5,
});

function isProxyCall(req) {
  return !!API_PROXY_KEY && safeEqual(req.headers['x-proxy-key'], API_PROXY_KEY);
}
function requireProxy(req, res, next) {
  if (!API_PROXY_KEY || isProxyCall(req)) return next();
  return res.status(404).json({ error: 'Not found' });
}
const clientIp = (req) => (isProxyCall(req) && req.headers['x-client-ip']) ? String(req.headers['x-client-ip']).slice(0, 64) : req.ip;

// --- Anti brute-force pour l'admin : 4 échecs max -> bannissement 1h par IP ---
const adminFailures = new Map(); // ip -> { count: number, lockedUntil: number }

function checkAdminIpLock(req, res, next) {
  const ip = clientIp(req);
  const fail = adminFailures.get(ip);
  if (fail && fail.lockedUntil > Date.now()) {
    const remainingMinutes = Math.ceil((fail.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({
      error: `Accès administrateur temporairement bloqué (4 tentatives échouées). Réessaie dans ${remainingMinutes} minute(s).`,
      locked: true,
      lockedUntil: fail.lockedUntil,
    });
  }
  next();
}

function registerAdminFailure(ip) {
  const fail = adminFailures.get(ip) || { count: 0, lockedUntil: 0 };
  fail.count += 1;
  if (fail.count >= 4) {
    fail.lockedUntil = Date.now() + 60 * 60 * 1000; // 1 heure de ban
  }
  adminFailures.set(ip, fail);
  return fail;
}

function resetAdminFailure(ip) {
  adminFailures.delete(ip);
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, fail] of adminFailures.entries()) {
    if (fail.lockedUntil && fail.lockedUntil < now) adminFailures.delete(ip);
  }
}, 60 * 1000).unref();

function signPlayerToken(keyData) {
  return jwt.sign(
    {
      id: keyData.id,
      keyCode: keyData.keyCode,
      username: keyData.playerName,
      pseudo: keyData.playerName,
      role: 'player',
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function signAdminToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });
}

function playerAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

function adminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const adminCodeHeader = req.headers['x-admin-code'];

  if (adminCodeHeader && safeEqual(adminCodeHeader, ADMIN_CODE)) {
    req.admin = true;
    return next();
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded && decoded.role === 'admin') {
        req.admin = true;
        return next();
      }
    } catch (e) {}
  }

  return res.status(401).json({ error: 'Accès administrateur non autorisé.' });
}

app.use('/api', requireProxy);

// ------------------------------------------------------------------
// REST : Authentification Clé Joueur & Administration
// ------------------------------------------------------------------

// 1. Authentification Joueur par Clé
app.post('/api/login-key', requireProxy, async (req, res) => {
  try {
    const rawKey = req.body?.key || req.body?.keyCode;
    const cleanKeyStr = cleanText(rawKey, 60).toUpperCase();

    if (!cleanKeyStr) {
      return res.status(400).json({ error: 'Veuillez saisir votre clé d\'accès.' });
    }

    const keyData = await db.findKeyByCode(cleanKeyStr);
    if (!keyData) {
      return res.status(401).json({ error: 'Clé d\'accès invalide ou introuvable.' });
    }

    if (keyData.expiresAt && keyData.expiresAt < Date.now()) {
      return res.status(401).json({ error: 'Cette clé d\'accès a expiré.' });
    }

    // Option A : vérification de session active sur un autre téléphone
    const activeSocketId = activeSessions.get(keyData.keyCode);
    if (activeSocketId && io.sockets.sockets.has(activeSocketId)) {
      return res.status(409).json({
        error: 'Cette clé est actuellement active sur un autre téléphone/appareil.',
        code: 'KEY_ALREADY_ACTIVE',
      });
    }

    const token = signPlayerToken(keyData);
    return res.json({
      message: 'Connexion réussie.',
      token,
      user: {
        id: keyData.id,
        username: keyData.playerName,
        pseudo: keyData.playerName,
        keyCode: keyData.keyCode,
        expiresAt: keyData.expiresAt,
      },
    });
  } catch (err) {
    console.error('[login-key] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 2. Connexion Administrateur
app.post('/api/admin/login', requireProxy, checkAdminIpLock, async (req, res) => {
  try {
    const { adminCode } = req.body || {};
    const ip = clientIp(req);

    if (!adminCode || !safeEqual(String(adminCode).trim(), ADMIN_CODE)) {
      const fail = registerAdminFailure(ip);
      const remaining = 4 - fail.count;
      if (fail.count >= 4) {
        return res.status(429).json({
          error: 'Code administrateur incorrect. 4 tentatives échouées : accès bloqué pendant 1 heure.',
          locked: true,
        });
      }
      return res.status(401).json({
        error: `Code administrateur incorrect (${remaining} tentative(s) restante(s)).`,
        attemptsRemaining: remaining,
      });
    }

    resetAdminFailure(ip);
    const token = signAdminToken();
    return res.json({ message: 'Connexion administrateur réussie.', token });
  } catch (err) {
    console.error('[admin/login] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 3. Clés Administrateur : Générer une clé
app.post('/api/admin/keys/generate', requireProxy, adminAuthMiddleware, async (req, res) => {
  try {
    const { playerName, duration } = req.body || {};
    const cleanName = cleanText(playerName, 24);

    if (!cleanName) {
      return res.status(400).json({ error: 'Le nom du joueur est obligatoire.' });
    }

    let durationMs = null;
    switch (String(duration).toLowerCase()) {
      case '1h': durationMs = 1 * 3600 * 1000; break;
      case '24h': durationMs = 24 * 3600 * 1000; break;
      case '7d': durationMs = 7 * 86400 * 1000; break;
      case '15d': durationMs = 15 * 86400 * 1000; break;
      case '30d': durationMs = 30 * 86400 * 1000; break;
      case 'infinite':
      case 'infinie':
      default: durationMs = null; break;
    }

    const expiresAt = durationMs ? Date.now() + durationMs : null;
    const keyCode = generateAccessKeyString();
    const keyId = genId('key');

    const result = await db.createKey({
      id: keyId,
      keyCode,
      playerName: cleanName,
      expiresAt,
      createdAt: Date.now(),
    });

    if (!result.ok) {
      return res.status(409).json({ error: 'Erreur lors de la génération de la clé (conflit).' });
    }

    return res.status(201).json({
      message: 'Clé générée avec succès.',
      key: result.key,
    });
  } catch (err) {
    console.error('[admin/keys/generate] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 4. Clés Administrateur : Lister les clés
app.get('/api/admin/keys', requireProxy, adminAuthMiddleware, async (req, res) => {
  try {
    const list = await db.getAllKeys();
    const keysWithStatus = list.map((k) => {
      const activeSockId = activeSessions.get(k.keyCode);
      const isActive = Boolean(activeSockId && io.sockets.sockets.has(activeSockId));
      const isExpired = Boolean(k.expiresAt && k.expiresAt < Date.now());
      return {
        ...k,
        isActive,
        isExpired,
      };
    });
    return res.json({ keys: keysWithStatus });
  } catch (err) {
    console.error('[admin/keys] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 5. Clés Administrateur : Supprimer une clé
app.delete('/api/admin/keys/:id', requireProxy, adminAuthMiddleware, async (req, res) => {
  try {
    const keyId = req.params.id;
    if (!keyId) return res.status(400).json({ error: 'ID de clé requis.' });

    // Si la clé est en cours d'utilisation, on déconnecte le socket
    const allKeys = await db.getAllKeys();
    const targetKey = allKeys.find((k) => k.id === keyId);
    if (targetKey) {
      const activeSockId = activeSessions.get(targetKey.keyCode);
      if (activeSockId) {
        const sock = io.sockets.sockets.get(activeSockId);
        if (sock) {
          sock.emit('kicked', { roomId: '', roomName: '', banned: true, reason: 'Clé supprimée par l\'administrateur.' });
          sock.disconnect(true);
        }
        activeSessions.delete(targetKey.keyCode);
      }
    }

    await db.deleteKey(keyId);
    return res.json({ message: 'Clé supprimée avec succès.' });
  } catch (err) {
    console.error('[admin/keys/delete] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 6. Statistiques Administrateur
app.get('/api/admin/stats', requireProxy, adminAuthMiddleware, async (req, res) => {
  try {
    const totalKeys = await db.countKeys();
    let activeKeysCount = 0;
    for (const [k, sockId] of activeSessions.entries()) {
      if (io.sockets.sockets.has(sockId)) activeKeysCount++;
    }
    const totalPlayers = Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0);

    return res.json({
      totalKeys,
      activeKeysCount,
      totalRooms: rooms.size,
      totalPlayersInRooms: totalPlayers,
      connectedSockets: io.engine.clientsCount,
      db: db.getMode(),
    });
  } catch (err) {
    console.error('[admin/stats] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 7. Vérification de Session (`/api/me`)
app.get('/api/me', requireProxy, playerAuthMiddleware, async (req, res) => {
  if (req.user?.role === 'admin') {
    return res.json({ user: { username: 'Administrateur', role: 'admin' } });
  }

  const keyCode = req.user?.keyCode;
  if (!keyCode) return res.status(401).json({ error: 'Session invalide.' });

  const keyData = await db.findKeyByCode(keyCode);
  if (!keyData) return res.status(401).json({ error: 'Clé introuvable ou supprimée.' });
  if (keyData.expiresAt && keyData.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Cette clé d\'accès a expiré.' });
  }

  return res.json({
    user: {
      id: keyData.id,
      username: keyData.playerName,
      pseudo: keyData.playerName,
      keyCode: keyData.keyCode,
      expiresAt: keyData.expiresAt,
    },
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/rooms', (req, res) => res.json({ rooms: publicRoomList() }));

// Express Static Dashboard fallback
if (ENABLE_DASHBOARD) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const indexPath = path.join(__dirname, 'public', 'index.html');
    // IMPORTANT : res.sendFile() sans gestion d'erreur fait planter TOUT le
    // process Node si le fichier est absent (ENOENT non rattrapé), ce qui
    // provoquait un redémarrage en boucle du serveur (toutes les connexions
    // coupées en même temps, rafale de "ping timeout"). On vérifie d'abord
    // que le fichier existe, et on répond proprement sinon — ne jamais
    // laisser une page web cassée faire tomber tout le multijoueur.
    if (!fs.existsSync(indexPath)) {
      console.error(`[Dashboard] Fichier introuvable: ${indexPath} — vérifie le déploiement (dossier public/ manquant ?).`);
      return res.status(200).type('text/plain').send('Proton Bus server — online (dashboard indisponible)');
    }
    res.sendFile(indexPath, (err) => {
      if (err) {
        console.error('[Dashboard] Erreur sendFile:', err.message);
        if (!res.headersSent) res.status(200).type('text/plain').send('Proton Bus server — online');
      }
    });
  });
} else {
  app.get('/', (req, res) => res.type('text/plain').send('Proton Bus server — online'));
}
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ------------------------------------------------------------------
// Socket.io : Handshake & Logic
// ------------------------------------------------------------------
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  socket.user = null;
  socket.data.web = socket.handshake.auth?.client === 'web';

  if (token) {
    try {
      const decoded = jwt.verify(String(token), JWT_SECRET);
      if (decoded && decoded.keyCode) {
        const keyData = await db.findKeyByCode(decoded.keyCode);
        if (!keyData || (keyData.expiresAt && keyData.expiresAt < Date.now())) {
          const err = new Error('KEY_EXPIRED');
          err.data = { code: 'KEY_EXPIRED' };
          return next(err);
        }

        // Option A : vérification session unique active
        const existingSockId = activeSessions.get(keyData.keyCode);
        if (existingSockId && existingSockId !== socket.id && io.sockets.sockets.has(existingSockId)) {
          const err = new Error('KEY_ALREADY_ACTIVE');
          err.data = { code: 'KEY_ALREADY_ACTIVE' };
          return next(err);
        }

        socket.user = {
          id: keyData.id,
          username: keyData.playerName,
          pseudo: keyData.playerName,
          keyCode: keyData.keyCode,
        };
        socket.data.keyCode = keyData.keyCode;
      } else if (decoded && decoded.role === 'admin') {
        socket.user = { id: 'admin', username: 'Administrateur', role: 'admin' };
      }
    } catch (e) {
      socket.user = null;
    }
  }

  if (REQUIRE_AUTH && !socket.user) {
    const err = new Error('AUTH_REQUIRED');
    err.data = { code: 'AUTH_REQUIRED' };
    return next(err);
  }
  next();
});

function getRoomOf(sock) {
  return sock.data.roomId ? rooms.get(sock.data.roomId) : null;
}

function membersOf(room) {
  return Array.from(room.players.values()).map((p) => ({
    socketId: p.socketId,
    userId: p.userId,
    username: p.username,
    inVoice: !!p.inVoice,
    muted: !!p.muted,
  }));
}

const webRoom = (room) => `web:${room.id}`;

function emitMembers(room) {
  io.to(webRoom(room)).emit('roomMembers', { roomId: room.id, hostId: room.hostId, members: membersOf(room) });
}

function emitBans(room) {
  if (!room.hostId || !io.sockets.sockets.get(room.hostId)?.data.web) return;
  io.to(room.hostId).emit('roomBans', {
    roomId: room.id,
    bans: Array.from(room.bans.entries()).map(([key, name]) => ({ key, name })),
  });
}

function joinRoomInternal(sock, roomId, { password, mapId, busId, username, pseudo, vehicleId, skinId, busInfo }) {
  const room = rooms.get(roomId);
  if (!room) return { ok: false, error: 'Room introuvable.' };

  const finalUsername = cleanText(sock.user?.username || sock.user?.pseudo || username || pseudo || `Joueur_${sock.id.slice(0, 5)}`, 24);
  const userId = sock.user?.id || genId('user');

  if (room.bans.has(`u:${userId}`) || room.bans.has(`n:${userKey(finalUsername)}`)) {
    return { ok: false, error: 'Tu as été banni de cette room.', code: 'BANNED' };
  }
  if (room.players.size >= room.maxPlayers) return { ok: false, error: 'Room pleine.' };

  if (room.passwordHash) {
    const providedOk = password && bcrypt.compareSync(String(password), room.passwordHash);
    if (!providedOk) return { ok: false, error: 'Mot de passe incorrect.' };
  }

  if (mapId && String(mapId) !== room.mapId) {
    return { ok: false, error: `Incompatibilité de carte : la room exige mapId="${room.mapId}".`, code: 'MAP_MISMATCH' };
  }
  if (busId && String(busId) !== room.busId) {
    return { ok: false, error: `Incompatibilité de bus : la room exige busId="${room.busId}".`, code: 'BUS_MISMATCH' };
  }

  const player = {
    socketId: sock.id,
    userId,
    username: finalUsername,
    pseudo: finalUsername,
    vehicleId: String(vehicleId || busId || 'bus_default'),
    skinId: String(skinId || 'default'),
    busInfo: cleanBusInfo(busInfo),
    transform: null,
    lastUpdateTs: 0,
    inVoice: false,
    muted: false,
  };
  room.players.set(sock.id, player);
  sock.join(room.id);
  if (sock.data.web) sock.join(webRoom(room));
  sock.data.roomId = room.id;

  sock.to(room.id).emit('playerJoined', {
    socketId: sock.id,
    userId: player.userId,
    username: player.username,
    pseudo: player.pseudo,
    vehicleId: player.vehicleId,
    skinId: player.skinId,
    busInfo: player.busInfo,
  });

  sock.emit('roomState', {
    room: publicRoom(room),
    players: Array.from(room.players.values())
      .filter((p) => p.socketId !== sock.id)
      .map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        username: p.username,
        pseudo: p.pseudo,
        vehicleId: p.vehicleId,
        skinId: p.skinId,
        busInfo: p.busInfo,
        transform: p.transform,
      })),
  });

  emitMembers(room);
  if (room.hostId === sock.id) emitBans(room);
  return { ok: true, room: publicRoom(room) };
}

function removeFromRoom(sock) {
  const roomId = sock.data.roomId;
  if (!roomId) return;
  sock.data.roomId = null;
  const room = rooms.get(roomId);
  if (!room) return;

  const leaving = room.players.get(sock.id);
  room.players.delete(sock.id);
  sock.leave(room.id);
  sock.leave(webRoom(room));

  if (leaving?.inVoice) sock.to(webRoom(room)).emit('voice:peer-left', { socketId: sock.id });
  sock.to(room.id).emit('playerLeft', {
    socketId: sock.id,
    userId: leaving?.userId,
    username: leaving?.username || leaving?.pseudo,
  });

  if (room.players.size === 0) {
    rooms.delete(room.id);
  } else {
    if (room.hostId === sock.id) {
      const nextHost = Array.from(room.players.values())[0];
      room.hostId = nextHost.socketId;
      io.to(room.id).emit('hostChanged', {
        newHostId: nextHost.socketId,
        newHostUsername: nextHost.username,
        newHostPseudo: nextHost.pseudo,
        room: publicRoom(room),
      });
      emitBans(room);
    }
    emitMembers(room);
  }
  io.emit('roomList', publicRoomList());
}

// Socket Connection Events
io.on('connection', (socket) => {
  if (socket.data.keyCode) {
    activeSessions.set(socket.data.keyCode, socket.id);
  }
  socket.data.roomId = null;
  console.log(`[socket] connecté: ${socket.id} (${socket.user?.username || 'invité'})`);

  let winStart = Date.now();
  let winCount = 0;
  socket.use(([event], next) => {
    if (event === 'vehicleUpdate' || event === 'voiceState') return next();
    const now = Date.now();
    if (now - winStart > 5000) { winStart = now; winCount = 0; }
    if (++winCount > 40) return next(new Error('RATE_LIMITED'));
    next();
  });
  socket.on('error', () => {});

  socket.emit('roomList', publicRoomList());

  socket.on('getRooms', (callback) => {
    const roomList = publicRoomList();
    socket.emit('roomList', roomList);
    if (typeof callback === 'function') callback({ ok: true, rooms: roomList });
  });

  socket.on('createRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      if (!validatePayloadSize(payload, 30, 500)) {
        logSecuThrottled(`createRoom_size_${socket.id}`, `Socket ${socket.id} - Payload createRoom invalide ou trop grand.`);
        return ack({ ok: false, error: 'Payload invalide ou trop volumineux.' });
      }

      const ip = socket.handshake.address || socket.id;
      if (!checkRoomCreationLimit(socket.id) || !checkRoomCreationLimit(ip)) {
        logSecuThrottled(`createRoom_rate_${socket.id}`, `Socket ${socket.id} (${ip}) - Limit room creation dépassé.`);
        return ack({ ok: false, error: 'Trop de tentatives de création de salons. Veuillez patienter.' });
      }

      const hmacResult = verifyHmacSignature('createRoom', payload);
      if (!hmacResult.ok) {
        logSecuThrottled(`createRoom_hmac_${socket.id}`, `Signature HMAC createRoom invalid/refused pour ${socket.id}: ${hmacResult.reason}`);
        if (REQUIRE_HMAC_SIG) {
          return ack({ ok: false, error: 'Signature HMAC invalide ou expirée.', code: 'INVALID_HMAC' });
        }
      }

      const { roomName, name, isPrivate, password, mapId, busId, maxPlayers, username: pu, pseudo: pp } = payload || {};
      const username = socket.user?.username || socket.user?.pseudo || pu || pp || `Joueur_${socket.id.slice(0, 5)}`;

      const finalRoomName = cleanText(roomName || name, 60);
      const finalMapId = cleanText(mapId || 'map_tana', 80);
      const finalBusId = cleanText(busId || 'bus_default', 80);
      if (!finalRoomName) return ack({ ok: false, error: 'Le nom du salon est requis.' });

      if (socket.data.roomId) removeFromRoom(socket);

      const room = {
        id: genId('room'),
        name: finalRoomName,
        isPrivate: Boolean(isPrivate) || Boolean(password),
        passwordHash: password ? bcrypt.hashSync(String(password), 10) : null,
        mapId: finalMapId,
        busId: finalBusId,
        maxPlayers: Number.isInteger(maxPlayers) && maxPlayers > 0 ? Math.min(maxPlayers, 64) : DEFAULT_MAX_PLAYERS,
        hostId: socket.id,
        players: new Map(),
        bans: new Map(),
        createdAt: Date.now(),
      };
      rooms.set(room.id, room);

      const joinResult = joinRoomInternal(socket, room.id, { password, mapId: finalMapId, busId: finalBusId, username, pseudo: username });
      if (!joinResult.ok) {
        rooms.delete(room.id);
        return ack(joinResult);
      }
      io.emit('roomList', publicRoomList());
      return ack({ ok: true, room: publicRoom(room) });
    } catch (err) {
      console.error('[createRoom] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  socket.on('joinRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      if (!validatePayloadSize(payload, 30, 500)) {
        logSecuThrottled(`joinRoom_size_${socket.id}`, `Socket ${socket.id} - Payload joinRoom invalide ou trop grand.`);
        return ack({ ok: false, error: 'Payload invalide ou trop volumineux.' });
      }

      const { roomId } = payload || {};
      if (!roomId) return ack({ ok: false, error: 'roomId requis.' });

      const hmacResult = verifyHmacSignature('joinRoom', payload, String(roomId));
      if (!hmacResult.ok) {
        logSecuThrottled(`joinRoom_hmac_${socket.id}`, `Signature HMAC joinRoom invalid/refused pour ${socket.id}: ${hmacResult.reason}`);
        if (REQUIRE_HMAC_SIG) {
          return ack({ ok: false, error: 'Signature HMAC invalide ou expirée.', code: 'INVALID_HMAC' });
        }
      }

      if (socket.data.roomId && socket.data.roomId !== roomId) removeFromRoom(socket);

      const result = joinRoomInternal(socket, String(roomId), payload || {});
      if (result.ok) io.emit('roomList', publicRoomList());
      return ack(result);
    } catch (err) {
      console.error('[joinRoom] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  socket.on('startGame', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      const room = getRoomOf(socket);
      if (!room) return ack({ ok: false, error: 'Vous n\'êtes dans aucune room.' });
      if (room.hostId !== socket.id) return ack({ ok: false, error: 'Seul l\'hôte peut démarrer la partie.' });

      if (payload && payload.mapId) room.mapId = cleanText(payload.mapId, 80);
      const pubRoom = publicRoom(room);
      io.to(room.id).emit('GAME_STARTED', { mapId: room.mapId, room: pubRoom });
      io.to(room.id).emit('gameStarted', { mapId: room.mapId, room: pubRoom });
      return ack({ ok: true, message: 'Partie démarrée !', mapId: room.mapId, room: pubRoom });
    } catch (err) {
      console.error('[startGame] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  socket.on('leaveRoom', (callback) => {
    removeFromRoom(socket);
    if (typeof callback === 'function') callback({ ok: true });
  });

  function hostTarget(payload, ack) {
    const room = getRoomOf(socket);
    if (!room) { ack({ ok: false, error: 'Vous n\'êtes dans aucune room.' }); return null; }
    if (room.hostId !== socket.id) { ack({ ok: false, error: 'Réservé au créateur de la room.' }); return null; }
    const targetId = String(payload?.socketId || '');
    if (!targetId || targetId === socket.id) { ack({ ok: false, error: 'Cible invalide.' }); return null; }
    const target = room.players.get(targetId);
    if (!target) { ack({ ok: false, error: 'Joueur introuvable dans la room.' }); return null; }
    return { room, target, targetSock: io.sockets.sockets.get(targetId) };
  }

  function socketsOfUser(room, target, hostSocketId) {
    const key = userKey(target.username);
    return Array.from(room.players.values())
      .filter((p) => p.socketId !== hostSocketId && (p.socketId === target.socketId || userKey(p.username) === key))
      .map((p) => io.sockets.sockets.get(p.socketId))
      .filter(Boolean);
  }

  socket.on('kickPlayer', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const t = hostTarget(payload, ack);
    if (!t) return;
    for (const sock of socketsOfUser(t.room, t.target, socket.id)) {
      sock.emit('kicked', { roomId: t.room.id, roomName: t.room.name, banned: false });
      removeFromRoom(sock);
    }
    ack({ ok: true });
  });

  socket.on('banPlayer', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const t = hostTarget(payload, ack);
    if (!t) return;
    const { room, target, targetSock } = t;
    const isGuest = !targetSock?.user;
    room.bans.set(isGuest ? `n:${userKey(target.username)}` : `u:${target.userId}`, target.username);
    if (!isGuest) room.bans.set(`n:${userKey(target.username)}`, target.username);
    for (const sock of socketsOfUser(room, target, socket.id)) {
      sock.emit('kicked', { roomId: room.id, roomName: room.name, banned: true });
      removeFromRoom(sock);
    }
    emitBans(room);
    ack({ ok: true });
  });

  socket.on('unbanPlayer', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const room = getRoomOf(socket);
    if (!room || room.hostId !== socket.id) return ack({ ok: false, error: 'Réservé au créateur de la room.' });
    const name = room.bans.get(String(payload?.key || ''));
    if (name === undefined) return ack({ ok: false, error: 'Entrée introuvable.' });
    for (const [k, v] of Array.from(room.bans.entries())) if (v === name) room.bans.delete(k);
    emitBans(room);
    ack({ ok: true });
  });

  socket.on('closeRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const room = getRoomOf(socket);
    if (!room) return ack({ ok: false, error: 'Vous n\'êtes dans aucune room.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Réservé au créateur de la room.' });

    const hostName = room.players.get(socket.id)?.username || '';
    socket.to(webRoom(room)).emit('roomClosed', { roomId: room.id, roomName: room.name, by: hostName });
    for (const sid of Array.from(room.players.keys())) {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.data.roomId = null; s.leave(room.id); s.leave(webRoom(room)); }
    }
    rooms.delete(room.id);
    io.emit('roomList', publicRoomList());
    ack({ ok: true });
  });

  socket.on('roomChat', (payload) => {
    const room = getRoomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    const text = cleanText(payload?.text, 300);
    if (!text) return;
    io.to(webRoom(room)).emit('roomChat', {
      id: genId('msg'),
      socketId: socket.id,
      username: player.username,
      text,
      ts: Date.now(),
    });
  });

  socket.on('voice:join', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const room = getRoomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player) return ack({ ok: false, error: 'Vous n\'êtes dans aucune room.' });
    player.inVoice = true;
    player.muted = false;
    const peers = Array.from(room.players.values())
      .filter((p) => p.socketId !== socket.id && p.inVoice)
      .map((p) => ({ socketId: p.socketId, username: p.username }));
    ack({ ok: true, peers, iceServers: ICE_SERVERS });
    socket.to(webRoom(room)).emit('voice:peer-joined', { socketId: socket.id, username: player.username });
    emitMembers(room);
  });

  socket.on('voice:leave', () => {
    const room = getRoomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player || !player.inVoice) return;
    player.inVoice = false;
    player.muted = false;
    socket.to(webRoom(room)).emit('voice:peer-left', { socketId: socket.id });
    emitMembers(room);
  });

  socket.on('voice:state', (payload) => {
    const room = getRoomOf(socket);
    const player = room?.players.get(socket.id);
    if (!room || !player || !player.inVoice) return;
    player.muted = !!payload?.muted;
    emitMembers(room);
  });

  socket.on('voice:signal', (payload) => {
    const room = getRoomOf(socket);
    if (!room || !payload || typeof payload !== 'object') return;
    const target = room.players.get(String(payload.to || ''));
    const me = room.players.get(socket.id);
    if (!target || !me || !me.inVoice || !target.inVoice) return;
    let size = 0;
    try { size = JSON.stringify(payload.data || {}).length; } catch (e) { return; }
    if (size > 20000) return;
    io.to(target.socketId).emit('voice:signal', { from: socket.id, data: payload.data });
  });

  socket.on('vehicleUpdate', (payload) => {
    const room = getRoomOf(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (!validatePayloadSize(payload, 50, 500)) {
      logSecuThrottled(`vUpd_size_${socket.id}`, `Socket ${socket.id} - Payload vehicleUpdate invalide ou trop grand.`);
      return;
    }

    if (!checkVehicleUpdateRateLimit(socket)) {
      logSecuThrottled(`vUpd_rate_${socket.id}`, `Socket ${socket.id} - Rate limit vehicleUpdate dépassé (>35msg/s).`);
      return;
    }

    const hmacResult = verifyHmacSignature('vehicleUpdate', payload, room.id);
    if (!hmacResult.ok) {
      logSecuThrottled(`vUpd_hmac_${socket.id}`, `Signature HMAC vehicleUpdate invalid/refused pour ${socket.id}: ${hmacResult.reason}`);
      if (REQUIRE_HMAC_SIG) {
        return;
      }
    }

    const now = Date.now();
    if (now - player.lastUpdateTs < MIN_TICK_INTERVAL_MS) return;
    player.lastUpdateTs = now;

    if (!payload || typeof payload !== 'object') return;
    const position = payload.position || (payload.x !== undefined ? { x: payload.x, y: payload.y, z: payload.z } : null);
    const rotation = payload.rotation || (payload.rotX !== undefined ? { x: payload.rotX, y: payload.rotY, z: payload.rotZ, w: payload.rotW } : null);
    const controls = payload.controls;
    if (!position || !rotation) return;

    const ctrl = controls || {};
    const steerInput = Number(ctrl.steerInput ?? payload.steerInput) || 0;
    const throttle = Number(ctrl.throttle ?? payload.throttle) || 0;
    const brake = Number(ctrl.brake ?? payload.brake) || 0;
    const handbrake = Number(ctrl.handbrake ?? payload.handbrake) || 0;

    if (payload.vehicleId) player.vehicleId = cleanText(payload.vehicleId, 80);
    if (payload.skinId) player.skinId = cleanText(payload.skinId, 80);
    const cleanedBusInfo = cleanBusInfo(payload.busInfo);
    if (cleanedBusInfo) player.busInfo = cleanedBusInfo;

    const showNameTag = payload.showNameTag ?? true;
    const showVoiceIcon = payload.showVoiceIcon ?? false;
    const isTalking = payload.isTalking ?? false;

    const transform = {
      position: { x: Number(position.x) || 0, y: Number(position.y) || 0, z: Number(position.z) || 0 },
      rotation: { x: Number(rotation.x) || 0, y: Number(rotation.y) || 0, z: Number(rotation.z) || 0, w: Number(rotation.w) || 1 },
      controls: { steerInput, throttle, brake, handbrake },
      steerInput, throttle, brake, handbrake,
      ts: now,
    };
    player.transform = transform;

    socket.to(room.id).volatile.emit('vehicleUpdate', {
      roomId: room.id,
      socketId: socket.id,
      userId: player.userId,
      username: player.username,
      pseudo: player.pseudo,
      vehicleId: player.vehicleId,
      skinId: player.skinId,
      ...(cleanedBusInfo ? { busInfo: cleanedBusInfo } : {}),
      position: transform.position,
      rotation: transform.rotation,
      controls: transform.controls,
      steerInput, throttle, brake, handbrake,
      showNameTag, showVoiceIcon, isTalking,
      transform,
    });
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] déconnecté: ${socket.id} (${reason})`);
    if (socket.data.keyCode && activeSessions.get(socket.data.keyCode) === socket.id) {
      activeSessions.delete(socket.data.keyCode);
    }
    removeFromRoom(socket);
  });
});

// ------------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------------
db.init().then((mode) => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚌 Serveur Proton Bus — port ${PORT} — BDD: ${mode}`);
    console.log(`   CORS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '*'}`);
    console.log(`   ADMIN_CODE configuré: ${ADMIN_CODE ? 'OUI' : 'NON'}`);
  });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
