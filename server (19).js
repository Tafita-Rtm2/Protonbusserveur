/**
 * Proton Bus Simulator - Serveur Multijoueur
 * -------------------------------------------
 * Express (API REST) + Socket.io (temps réel) + Docker-ready pour Hugging Face Spaces.
 *
 * NOTE IMPORTANTE (Hugging Face Spaces) :
 * - Le port d'écoute DOIT être 7860.
 * - Le système de fichiers du conteneur est éphémère : les "bases de données"
 *   ci-dessous sont en mémoire (Map/Array). Redémarrage du Space = perte des données.
 *   Pour de la persistance réelle, brancher une vraie DB externe (ex: Supabase, Mongo Atlas).
 */

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

// ------------------------------------------------------------------
// Configuration générale
// ------------------------------------------------------------------
const PORT = process.env.PORT || 7860; // Exigence Hugging Face : port 7860
const JWT_SECRET = process.env.JWT_SECRET || 'proton-bus-dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const TICK_RATE = 30; // ticks/sec max
const MIN_TICK_INTERVAL_MS = 1000 / TICK_RATE; // ~33.33ms
const DEFAULT_MAX_PLAYERS = 10;

// ------------------------------------------------------------------
// "Base de données" en mémoire
// ------------------------------------------------------------------

/** @type {Map<string, {id:string, pseudo:string, passwordHash:string, createdAt:number}>} */
const users = new Map(); // clé = pseudo (insensible à la casse via pseudoKey)

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name
 * @property {string|null} passwordHash
 * @property {string} mapId
 * @property {string} busId
 * @property {number} maxPlayers
 * @property {string} hostId
 * @property {Map<string, Player>} players
 * @property {number} createdAt
 */

/**
 * @typedef {Object} Player
 * @property {string} socketId
 * @property {string} pseudo
 * @property {Object} transform  dernière position/rotation connue
 * @property {number} lastUpdateTs  horodatage du dernier broadcast (throttle 30Hz)
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

function pseudoKey(pseudo) {
  return String(pseudo || '').trim().toLowerCase();
}

function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ------------------------------------------------------------------
// Vue publique d'une room (jamais exposer passwordHash)
// ------------------------------------------------------------------
function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    hasPassword: !!room.passwordHash,
    mapId: room.mapId,
    busId: room.busId,
    maxPlayers: room.maxPlayers,
    playerCount: room.players.size,
    players: Array.from(room.players.values()).map((p) => p.pseudo),
    createdAt: room.createdAt,
  };
}

function publicRoomList() {
  return Array.from(rooms.values()).map(publicRoom);
}

// ------------------------------------------------------------------
// Express app
// ------------------------------------------------------------------
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  // Ping plus fréquent = détection de déconnexion plus rapide, utile en jeu temps réel.
  pingInterval: 10000,
  pingTimeout: 5000,
});

// ------------------------------------------------------------------
// Middleware d'authentification JWT (pour les routes REST protégées)
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Routes REST : Authentification
// ------------------------------------------------------------------

// POST /api/register  { pseudo, password }
app.post('/api/register', async (req, res) => {
  try {
    const { pseudo, password } = req.body || {};
    if (!pseudo || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
    }
    if (String(pseudo).trim().length < 3) {
      return res.status(400).json({ error: 'Le pseudo doit contenir au moins 3 caractères.' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    const key = pseudoKey(pseudo);
    if (users.has(key)) {
      return res.status(409).json({ error: 'Ce pseudo est déjà utilisé.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: genId('user'),
      pseudo: String(pseudo).trim(),
      passwordHash,
      createdAt: Date.now(),
    };
    users.set(key, user);

    const token = jwt.sign({ id: user.id, pseudo: user.pseudo }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.status(201).json({
      message: 'Compte créé avec succès.',
      token,
      user: { id: user.id, pseudo: user.pseudo },
    });
  } catch (err) {
    console.error('[register] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/login  { pseudo, password }
app.post('/api/login', async (req, res) => {
  try {
    const { pseudo, password } = req.body || {};
    if (!pseudo || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
    }

    const key = pseudoKey(pseudo);
    const user = users.get(key);
    if (!user) {
      return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect.' });
    }

    const token = jwt.sign({ id: user.id, pseudo: user.pseudo }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.json({
      message: 'Connexion réussie.',
      token,
      user: { id: user.id, pseudo: user.pseudo },
    });
  } catch (err) {
    console.error('[login] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ------------------------------------------------------------------
// Routes REST : Rooms (lecture seule ; la création/jonction se fait en WS)
// ------------------------------------------------------------------

// GET /api/rooms
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: publicRoomList() });
});

// GET /api/stats (utile pour le dashboard)
app.get('/api/stats', (req, res) => {
  const totalPlayers = Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0);
  res.json({
    totalUsers: users.size,
    totalRooms: rooms.size,
    totalPlayersInRooms: totalPlayers,
    connectedSockets: io.engine.clientsCount,
    tickRate: TICK_RATE,
  });
});

// Fallback : sert le dashboard pour toute route inconnue en GET (SPA-friendly)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------------------------------------------------------------
// Socket.io : authentification optionnelle du handshake
// ------------------------------------------------------------------
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (token) {
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      // Token invalide : on n'authentifie pas mais on n'empêche pas la connexion
      // (le pseudo "invité" sera utilisé si fourni côté client lors du join).
      socket.user = null;
    }
  }
  next();
});

// ------------------------------------------------------------------
// Socket.io : logique temps réel
// ------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[socket] connecté: ${socket.id} (${socket.user?.pseudo || 'invité'})`);

  // Chaque socket ne peut être que dans une seule room de jeu à la fois.
  let currentRoomId = null;

  // Envoie la liste des rooms au nouvel arrivant
  socket.emit('roomList', publicRoomList());

  // -------------------- Création de room --------------------
  // payload: { name, password, mapId, busId, maxPlayers, pseudo }
  socket.on('createRoom', (payload, callback) => {
    try {
      const { name, password, mapId, busId, maxPlayers, pseudo } = payload || {};
      const ack = typeof callback === 'function' ? callback : () => {};

      if (!name || !mapId || !busId) {
        return ack({ ok: false, error: 'name, mapId et busId sont requis.' });
      }

      const room = {
        id: genId('room'),
        name: String(name).trim().slice(0, 60),
        passwordHash: password ? bcryptSyncHash(password) : null,
        mapId: String(mapId),
        busId: String(busId),
        maxPlayers: Number.isInteger(maxPlayers) && maxPlayers > 0
          ? Math.min(maxPlayers, 64)
          : DEFAULT_MAX_PLAYERS,
        hostId: socket.id,
        players: new Map(),
        createdAt: Date.now(),
      };

      rooms.set(room.id, room);

      // Le créateur rejoint automatiquement sa room
      const joinResult = joinRoomInternal(socket, room.id, {
        password,
        mapId,
        busId,
        pseudo: pseudo || socket.user?.pseudo || `Joueur_${socket.id.slice(0, 5)}`,
      });

      if (!joinResult.ok) {
        rooms.delete(room.id); // rollback si le join échoue (ne devrait pas arriver ici)
        return ack(joinResult);
      }

      currentRoomId = room.id;
      io.emit('roomList', publicRoomList());
      return ack({ ok: true, room: publicRoom(room) });
    } catch (err) {
      console.error('[createRoom] erreur:', err);
      return typeof callback === 'function'
        ? callback({ ok: false, error: 'Erreur serveur.' })
        : undefined;
    }
  });

  // -------------------- Jonction de room --------------------
  // payload: { roomId, password, mapId, busId, pseudo }
  socket.on('joinRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      const { roomId } = payload || {};
      if (!roomId) return ack({ ok: false, error: 'roomId requis.' });

      const result = joinRoomInternal(socket, roomId, payload || {});
      if (result.ok) {
        currentRoomId = roomId;
        io.emit('roomList', publicRoomList());
      }
      return ack(result);
    } catch (err) {
      console.error('[joinRoom] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  /**
   * Logique interne partagée par createRoom/joinRoom.
   * Contrôle d'accès STRICT : mapId et busId du joueur doivent correspondre
   * EXACTEMENT à ceux de la room, en plus du mot de passe et de la capacité.
   */
  function joinRoomInternal(sock, roomId, { password, mapId, busId, pseudo }) {
    const room = rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room introuvable.' };

    if (room.players.size >= room.maxPlayers) {
      return { ok: false, error: 'Room pleine.' };
    }

    if (room.passwordHash) {
      const providedOk = password && bcrypt.compareSync(password, room.passwordHash);
      if (!providedOk) return { ok: false, error: 'Mot de passe incorrect.' };
    }

    // Contrôle d'accès strict map/bus
    if (String(mapId) !== room.mapId || String(busId) !== room.busId) {
      return {
        ok: false,
        error: `Incompatibilité de mods : la room exige mapId="${room.mapId}" et busId="${room.busId}".`,
        code: 'MOD_MISMATCH',
      };
    }

    const finalPseudo = (pseudo || sock.user?.pseudo || `Joueur_${sock.id.slice(0, 5)}`)
      .toString()
      .trim()
      .slice(0, 24);

    const player = {
      socketId: sock.id,
      pseudo: finalPseudo,
      transform: null,
      lastUpdateTs: 0,
    };
    room.players.set(sock.id, player);
    sock.join(room.id);

    // Notifie les autres membres de la room
    sock.to(room.id).emit('playerJoined', { socketId: sock.id, pseudo: finalPseudo });

    // Envoie l'état actuel de la room au nouvel arrivant (dont positions déjà connues)
    sock.emit('roomState', {
      room: publicRoom(room),
      players: Array.from(room.players.values())
        .filter((p) => p.socketId !== sock.id)
        .map((p) => ({ socketId: p.socketId, pseudo: p.pseudo, transform: p.transform })),
    });

    return { ok: true, room: publicRoom(room) };
  }

  // -------------------- Sortie volontaire de room --------------------
  socket.on('leaveRoom', () => {
    leaveCurrentRoom();
  });

  function leaveCurrentRoom() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      room.players.delete(socket.id);
      socket.leave(room.id);
      socket.to(room.id).emit('playerLeft', { socketId: socket.id });

      if (room.players.size === 0) {
        rooms.delete(room.id); // nettoyage : room vide supprimée
      }
      io.emit('roomList', publicRoomList());
    }
    currentRoomId = null;
  }

  // -------------------- Synchronisation véhicule (30 Hz max) --------------------
  // payload attendu :
  // {
  //   position: {x, y, z},
  //   rotation: {x, y, z, w},   // quaternion
  //   steerInput: number,
  //   throttle: number,        // accélérateur (0..1)
  //   brake: number            // frein (0..1)
  // }
  socket.on('vehicleUpdate', (payload) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    // Throttle serveur : on ignore les updates trop rapprochées (> 30 Hz)
    if (now - player.lastUpdateTs < MIN_TICK_INTERVAL_MS) return;
    player.lastUpdateTs = now;

    const { position, rotation, steerInput, throttle, brake } = payload || {};
    if (!position || !rotation) return; // payload invalide, on ignore silencieusement

    const transform = {
      position: {
        x: Number(position.x) || 0,
        y: Number(position.y) || 0,
        z: Number(position.z) || 0,
      },
      rotation: {
        x: Number(rotation.x) || 0,
        y: Number(rotation.y) || 0,
        z: Number(rotation.z) || 0,
        w: Number(rotation.w) || 1,
      },
      steerInput: Number(steerInput) || 0,
      throttle: Number(throttle) || 0,
      brake: Number(brake) || 0,
      ts: now,
    };
    player.transform = transform;

    // Diffusion instantanée à tous les AUTRES joueurs de la même room
    socket.to(room.id).volatile.emit('vehicleUpdate', {
      socketId: socket.id,
      pseudo: player.pseudo,
      transform,
    });
  });

  // -------------------- Déconnexion --------------------
  socket.on('disconnect', (reason) => {
    console.log(`[socket] déconnecté: ${socket.id} (${reason})`);
    leaveCurrentRoom();
  });
});

// bcrypt.hash est async ; pour la création de room (contexte non-async ici) on utilise
// la variante synchrone, acceptable vu la faible fréquence de création de rooms.
function bcryptSyncHash(password) {
  return bcrypt.hashSync(password, 10);
}

// ------------------------------------------------------------------
// Démarrage du serveur
// ------------------------------------------------------------------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚌 Proton Bus Multiplayer Server en écoute sur le port ${PORT}`);
  console.log(`   Tick rate max: ${TICK_RATE}/s (${MIN_TICK_INTERVAL_MS.toFixed(1)}ms/update)`);
});
