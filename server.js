/**
 * Proton Bus Simulator - Serveur Multijoueur (v2)
 * ------------------------------------------------
 * Express (API REST) + Socket.io (temps réel) — prêt pour Hugging Face Spaces (Docker, port 7860).
 *
 * Compatibilité : tous les événements Socket.io historiques utilisés par le mod du jeu sont conservés
 * (createRoom, joinRoom, leaveRoom, startGame, vehicleUpdate, busInfo, roomList, roomState, playerJoined,
 * playerLeft, hostChanged, GAME_STARTED/gameStarted). Les nouveautés sont PUREMENT ADDITIVES :
 * kickPlayer, banPlayer, unbanPlayer, closeRoom, roomChat, voice:*, roomMembers, roomBans.
 *
 * Variables d'environnement (Secrets du Space) :
 *   JWT_SECRET       secret de signature des tokens (OBLIGATOIRE en prod, sinon clé aléatoire à chaque boot)
 *   DATABASE_URL     PostgreSQL (Neon / Supabase ...) -> comptes persistants
 *   ALLOWED_ORIGINS  origines navigateur autorisées, séparées par des virgules (ex: https://mon-site.vercel.app)
 *   API_PROXY_KEY    si défini, /api/login|register|me n'acceptent QUE les appels portant l'en-tête x-proxy-key
 *   REQUIRE_AUTH     "true" => tout socket doit avoir un token valide (à activer quand le mod enverra un token)
 *   ADMIN_KEY        clé pour /api/stats (en-tête x-admin-key)
 *   ENABLE_DASHBOARD "true" => sert le dashboard de test public/ (désactivé par défaut)
 *   ICE_SERVERS      JSON de serveurs STUN/TURN pour le vocal (optionnel)
 *   SUPABASE_URL / SUPABASE_SECRET_KEY   base de comptes Supabase (voir supabase/schema.sql)
 *   SOCKET_PATH_KEY  (obsolète, IGNORÉ : le mod se connecte en dur sur /socket.io)
 *   ENABLE_DASHBOARD par défaut ACTIVÉ (menu du jeu public/index.html servi sur / et /launcher, comme avant) ; "false" pour couper.
 */

try { require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || undefined, quiet: true }); } catch (e) { /* dotenv optionnel : sur Hugging Face les Secrets sont déjà des variables d'environnement */ }

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

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('[SECURITE] ⚠️  JWT_SECRET absent : clé aléatoire générée (les sessions sauteront au prochain redémarrage). Définis JWT_SECRET dans les Secrets du Space.');
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH || '').toLowerCase() === 'true';
const API_PROXY_KEY = process.env.API_PROXY_KEY || '';
// Le mod natif se connecte EN DUR sur /socket.io. Déplacer ce chemin ferait fermer ses WebSocket sans réponse
// (le proxy Hugging Face renvoie alors "502 Bad Gateway"). SOCKET_PATH_KEY est donc volontairement IGNORÉ.
const SOCKET_PATH = '/socket.io';
if (process.env.SOCKET_PATH_KEY) console.warn('[CONFIG] SOCKET_PATH_KEY est ignoré (incompatible avec le mod du jeu). Tu peux le supprimer des Secrets.');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
// Comme l'ancien serveur : le menu du jeu (public/index.html) est servi par défaut. ENABLE_DASHBOARD=false pour le couper.
const ENABLE_DASHBOARD = String(process.env.ENABLE_DASHBOARD || 'true').toLowerCase() !== 'false';

let ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
try {
  if (process.env.ICE_SERVERS) ICE_SERVERS = JSON.parse(process.env.ICE_SERVERS);
} catch (e) {
  console.error('[VOCAL] ICE_SERVERS invalide (JSON attendu), valeur par défaut utilisée.');
}

/** Les clients natifs (mod du jeu) n'envoient pas d'Origin : toujours acceptés. Les navigateurs doivent être dans la liste. */
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
// Données en mémoire : rooms
// ------------------------------------------------------------------
/** @type {Map<string, any>} */
const rooms = new Map();

const userKey = (name) => String(name || '').trim().toLowerCase();
const genId = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

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
// Express
// ------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // Hugging Face / Vercel derrière un reverse-proxy
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
  maxHttpBufferSize: 1e5, // 100 Ko max par message (anti-abus)
});

// --- Protection "proxy" : l'API de comptes n'est appelable que depuis ton site (Vercel) -------------
function isProxyCall(req) {
  return !!API_PROXY_KEY && safeEqual(req.headers['x-proxy-key'], API_PROXY_KEY);
}
function requireProxy(req, res, next) {
  if (!API_PROXY_KEY || isProxyCall(req)) return next();
  return res.status(404).json({ error: 'Not found' }); // on ne confirme même pas que la route existe
}
// Vrai IP du joueur : transmise par le proxy Vercel (seulement si la clé est valide)
const clientIp = (req) => (isProxyCall(req) && req.headers['x-client-ip']) ? String(req.headers['x-client-ip']).slice(0, 64) : req.ip;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientIp,
  message: { error: 'Trop de tentatives. Réessaie dans quelques minutes.' },
});

// Anti brute-force par compte
const failed = new Map(); // key -> {n, until}
function isLocked(key) {
  const f = failed.get(key);
  return !!f && f.until > Date.now();
}
function registerFailure(key) {
  const f = failed.get(key) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 8) { f.until = Date.now() + 10 * 60 * 1000; f.n = 0; }
  failed.set(key, f);
}
setInterval(() => { const now = Date.now(); for (const [k, f] of failed) if (f.until && f.until < now) failed.delete(k); }, 60 * 1000).unref();

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré.' });
  }
}

const USERNAME_RE = /^[\p{L}\p{N}_.\- ]{3,20}$/u;

// Verrouillage global : si API_PROXY_KEY est défini, TOUTE route /api exige la clé (sinon 404 muet).
app.use('/api', requireProxy);

// ------------------------------------------------------------------
// REST : authentification
// ------------------------------------------------------------------
app.post('/api/register', requireProxy, authLimiter, async (req, res) => {
  try {
    const { username, pseudo, password } = req.body || {};
    const finalUsername = cleanText(username || pseudo, 20);

    if (!finalUsername || !password) return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    if (!USERNAME_RE.test(finalUsername)) {
      return res.status(400).json({ error: 'Nom d\'utilisateur : 3 à 20 caractères (lettres, chiffres, espace, _ . -).' });
    }
    if (String(password).length < 6 || String(password).length > 100) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir entre 6 et 100 caractères.' });
    }

    if (await db.findUserByName(finalUsername)) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });
    }

    const user = {
      id: genId('user'),
      username: finalUsername,
      pseudo: finalUsername,
      passwordHash: await bcrypt.hash(String(password), 11),
      createdAt: Date.now(),
    };
    const created = await db.createUser(user);
    if (!created.ok) return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });

    return res.status(201).json({
      message: 'Compte créé avec succès.',
      token: signToken(user),
      user: { id: user.id, username: user.username, pseudo: user.pseudo },
    });
  } catch (err) {
    console.error('[register] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/login', requireProxy, authLimiter, async (req, res) => {
  try {
    const { username, pseudo, password } = req.body || {};
    const finalUsername = cleanText(username || pseudo, 40);
    if (!finalUsername || !password) return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });

    const key = userKey(finalUsername);
    if (isLocked(key)) return res.status(429).json({ error: 'Compte temporairement verrouillé (trop d\'échecs). Réessaie dans 10 minutes.' });

    const user = await db.findUserByName(finalUsername);
    // bcrypt.compare même si l'utilisateur n'existe pas -> temps de réponse constant
    const valid = await bcrypt.compare(String(password), user ? user.passwordHash : '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !valid) {
      registerFailure(key);
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
    }
    failed.delete(key);

    return res.json({
      message: 'Connexion réussie.',
      token: signToken(user),
      user: { id: user.id, username: user.username, pseudo: user.pseudo },
    });
  } catch (err) {
    console.error('[login] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Vérifie un token et renvoie le compte (utilisé par le site au chargement)
app.get('/api/me', requireProxy, authMiddleware, async (req, res) => {
  const user = await db.findUserByName(req.user.username);
  if (!user || user.id !== req.user.id) return res.status(401).json({ error: 'Compte introuvable.' });
  res.json({ user: { id: user.id, username: user.username, pseudo: user.pseudo } });
});

// ------------------------------------------------------------------
// REST : infos
// ------------------------------------------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/rooms', (req, res) => res.json({ rooms: publicRoomList() }));

app.get('/api/stats', async (req, res) => {
  const allowed = ADMIN_KEY ? safeEqual(req.headers['x-admin-key'], ADMIN_KEY) : ENABLE_DASHBOARD;
  if (!allowed) return res.status(404).json({ error: 'Not found' });
  const totalPlayers = Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0);
  res.json({
    totalUsers: await db.countUsers(),
    totalRooms: rooms.size,
    totalPlayersInRooms: totalPlayers,
    connectedSockets: io.engine.clientsCount,
    tickRate: TICK_RATE,
    db: db.getMode(),
    requireAuth: REQUIRE_AUTH,
  });
});

// Launcher Android : l'APK charge ".../launcher". launcher.html s'il existe, sinon le menu index.html (qui contient le pont Android).
app.get('/launcher', (req, res) => {
  const f = path.join(__dirname, 'public', 'launcher.html');
  res.sendFile(fs.existsSync(f) ? f : path.join(__dirname, 'public', 'index.html'));
});

if (ENABLE_DASHBOARD) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
} else {
  app.get('/', (req, res) => res.type('text/plain').send('Proton Bus server — online'));
}
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ------------------------------------------------------------------
// Socket.io : handshake
// ------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  socket.user = null;
  socket.data.web = socket.handshake.auth?.client === 'web'; // le site Next.js ; le mod natif ne l'est pas
  if (token) {
    try { socket.user = jwt.verify(String(token), JWT_SECRET); } catch (e) { socket.user = null; }
  }
  if (REQUIRE_AUTH && !socket.user) {
    const err = new Error('AUTH_REQUIRED');
    err.data = { code: 'AUTH_REQUIRED' };
    return next(err);
  }
  next();
});

// ------------------------------------------------------------------
// Fonctions de room (niveau module : utilisables sur n'importe quel socket)
// ------------------------------------------------------------------
const getRoomOf = (sock) => (sock.data.roomId ? rooms.get(sock.data.roomId) : null);

function membersOf(room) {
  return Array.from(room.players.values()).map((p) => ({
    socketId: p.socketId,
    userId: p.userId,
    username: p.username,
    inVoice: !!p.inVoice,
    muted: !!p.muted,
  }));
}
// Les événements "site" (membres, bans, chat, vocal) ne vont QU'AUX clients web (salle socket.io "web:<roomId>").
// Le mod natif analyse les trames par recherche de texte : il doit recevoir exactement les mêmes trames qu'avant.
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

// ------------------------------------------------------------------
// Socket.io : temps réel
// ------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.roomId = null;
  console.log(`[socket] connecté: ${socket.id} (${socket.user?.username || 'invité'})`);

  // Limiteur d'événements (hors vehicleUpdate déjà throttlé) : 40 / 5 s
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

  // -------------------- createRoom --------------------
  socket.on('createRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      // Compte optionnel tant que le mod n'envoie pas de token (activer REQUIRE_AUTH ensuite).
      const { roomName, name, isPrivate, password, mapId, busId, maxPlayers, username: pu, pseudo: pp } = payload || {};
      const username = socket.user?.username || socket.user?.pseudo || pu || pp || `Joueur_${socket.id.slice(0, 5)}`;

      const finalRoomName = cleanText(roomName || name, 60);
      const finalMapId = cleanText(mapId || 'map_tana', 80);
      const finalBusId = cleanText(busId || 'bus_default', 80);
      if (!finalRoomName) return ack({ ok: false, error: 'Le nom du salon (roomName ou name) est requis.' });

      if (socket.data.roomId) removeFromRoom(socket); // un joueur = une seule room

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

  // -------------------- joinRoom --------------------
  socket.on('joinRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      const { roomId } = payload || {};
      if (!roomId) return ack({ ok: false, error: 'roomId requis.' });
      if (socket.data.roomId && socket.data.roomId !== roomId) removeFromRoom(socket);

      const result = joinRoomInternal(socket, String(roomId), payload || {});
      if (result.ok) io.emit('roomList', publicRoomList());
      return ack(result);
    } catch (err) {
      console.error('[joinRoom] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  // -------------------- startGame --------------------
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

  // -------------------- leaveRoom --------------------
  socket.on('leaveRoom', (callback) => {
    removeFromRoom(socket);
    if (typeof callback === 'function') callback({ ok: true });
  });

  // -------------------- Modération (hôte uniquement) --------------------
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

  // Un joueur peut être connecté deux fois (site + jeu) sous le même pseudo : on les retire ensemble.
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
    // Un compte est banni par son id ET son pseudo ; un invité par son pseudo seulement.
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

  // -------------------- Chat de room --------------------
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

  // -------------------- Vocal (signalisation WebRTC ; l'audio passe en P2P) --------------------
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

  // -------------------- vehicleUpdate (30 Hz max) — INCHANGÉ --------------------
  socket.on('vehicleUpdate', (payload) => {
    const room = getRoomOf(socket);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    if (now - player.lastUpdateTs < MIN_TICK_INTERVAL_MS) return;
    player.lastUpdateTs = now;

    if (!payload || typeof payload !== 'object') return;
    const { position, rotation, controls } = payload;
    if (!position || !rotation) return;

    const ctrl = controls || {};
    const steerInput = Number(ctrl.steerInput ?? payload.steerInput) || 0;
    const throttle = Number(ctrl.throttle ?? payload.throttle) || 0;
    const brake = Number(ctrl.brake ?? payload.brake) || 0;
    const handbrake = Number(ctrl.handbrake ?? payload.handbrake) || 0;

    if (payload.vehicleId) player.vehicleId = String(payload.vehicleId);
    if (payload.skinId) player.skinId = String(payload.skinId);
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
    removeFromRoom(socket);
  });
});

// ------------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------------
db.init().then((mode) => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚌 Proton Bus Multiplayer Server — port ${PORT} — DB: ${mode}`);
    console.log(`   CORS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '* (aucune restriction — définis ALLOWED_ORIGINS)'}`);
    console.log(`   REQUIRE_AUTH=${REQUIRE_AUTH}  API_PROXY_KEY=${API_PROXY_KEY ? 'oui' : 'non'}  Dashboard=${ENABLE_DASHBOARD}`);
  });
});

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
