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
const { loadUsers, saveUsers } = require('./db');

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
// Base de données locale autonome (JSON)
// ------------------------------------------------------------------

/** @type {Map<string, {id:string, username:string, pseudo:string, passwordHash:string, createdAt:number}>} */
const users = loadUsers(); // charge au démarrage

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name
 * @property {boolean} isPrivate
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
 * @property {string} userId
 * @property {string} username
 * @property {string} pseudo
 * @property {Object} transform  dernière position/rotation connue
 * @property {number} lastUpdateTs  horodatage du dernier broadcast (throttle 30Hz)
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

function userKey(name) {
  return String(name || '').trim().toLowerCase();
}

function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// ------------------------------------------------------------------
// Vue publique d'une room (jamais exposer passwordHash)
// ------------------------------------------------------------------
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
    hostUsername: hostUsername,
    players: Array.from(room.players.values()).map((p) => p.username || p.pseudo),
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

// Middleware de gestion des erreurs de syntaxe JSON (ex: payload texte brut invalide)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Format JSON invalide' });
  }
  next(err);
});

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

// POST /api/register  { username, pseudo, password }
app.post('/api/register', async (req, res) => {
  try {
    const { username, pseudo, password } = req.body || {};
    const finalUsername = String(username || pseudo || '').trim();

    if (!finalUsername || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur (username) et mot de passe requis.' });
    }
    if (finalUsername.length < 3) {
      return res.status(400).json({ error: 'Le nom d\'utilisateur doit contenir au moins 3 caractères.' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 4 caractères.' });
    }

    const key = userKey(finalUsername);
    if (users.has(key)) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: genId('user'),
      username: finalUsername,
      pseudo: finalUsername,
      passwordHash,
      createdAt: Date.now(),
    };
    users.set(key, user);
    saveUsers(users);

    const token = jwt.sign({ id: user.id, username: user.username, pseudo: user.pseudo }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.status(201).json({
      message: 'Compte créé avec succès.',
      token,
      user: { id: user.id, username: user.username, pseudo: user.pseudo },
    });
  } catch (err) {
    console.error('[register] erreur:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/login  { username, pseudo, password }
app.post('/api/login', async (req, res) => {
  try {
    const { username, pseudo, password } = req.body || {};
    const finalUsername = String(username || pseudo || '').trim();

    if (!finalUsername || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur (username) et mot de passe requis.' });
    }

    const key = userKey(finalUsername);
    const user = users.get(key);
    if (!user) {
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, pseudo: user.pseudo }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    return res.json({
      message: 'Connexion réussie.',
      token,
      user: { id: user.id, username: user.username, pseudo: user.pseudo },
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

// Route explicite pour le Launcher Android (MainActivity.kt charge
// ".../launcher" sans extension .html — express.static ne sert que le nom de
// fichier exact "launcher.html", donc sans cette route, /launcher tombait
// dans le fallback ci-dessous et affichait le dashboard au lieu du vrai
// launcher. C'était la cause du bug "chacun crée sa propre room".
app.get('/launcher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'launcher.html'));
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
  const connectedUsername = socket.user?.username || socket.user?.pseudo || 'invité';
  console.log(`[socket] connecté: ${socket.id} (${connectedUsername})`);

  // Chaque socket ne peut être que dans une seule room de jeu à la fois.
  let currentRoomId = null;

  // Envoie la liste des rooms au nouvel arrivant
  socket.emit('roomList', publicRoomList());

  // -------------------- Obtenir les rooms (getRooms) --------------------
  socket.on('getRooms', (callback) => {
    const roomList = publicRoomList();
    socket.emit('roomList', roomList);
    if (typeof callback === 'function') {
      callback({ ok: true, rooms: roomList });
    }
  });

  // -------------------- Création de room --------------------
  // payload: { roomName, name, isPrivate, password, mapId, busId, maxPlayers, username, pseudo }
  socket.on('createRoom', (payload, callback) => {
    try {
      const ack = typeof callback === 'function' ? callback : () => {};

      // Compte obligatoire : impossible de créer une room sans être authentifié
      // (token JWT valide fourni à la connexion Socket.io). Ce contrôle est
      // fait ICI, côté serveur — pas seulement caché dans le dashboard — donc
      // aucun client (dashboard, launcher, mod du jeu) ne peut le contourner.
      if (!socket.user) {
        return ack({
          ok: false,
          error: 'Compte requis : connecte-toi (POST /api/login) avant de créer une room.',
          code: 'AUTH_REQUIRED',
        });
      }

      const { roomName, name, isPrivate, password, mapId, busId, maxPlayers } = payload || {};
      // Le pseudo vient du compte authentifié, jamais du payload client
      // (évite qu'un joueur usurpe le pseudo d'un autre en le tapant en dur).
      const username = socket.user.username || socket.user.pseudo;
      const pseudo = username;

      const finalRoomName = String(roomName || name || '').trim();
      const finalMapId = String(mapId || 'map_tana').trim();
      const finalBusId = String(busId || 'bus_default').trim();

      if (!finalRoomName) {
        return ack({ ok: false, error: 'Le nom du salon (roomName ou name) est requis.' });
      }

      const roomIsPrivate = Boolean(isPrivate) || Boolean(password);

      const room = {
        id: genId('room'),
        name: finalRoomName.slice(0, 60),
        isPrivate: roomIsPrivate,
        passwordHash: password ? bcryptSyncHash(password) : null,
        mapId: finalMapId,
        busId: finalBusId,
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
        mapId: finalMapId,
        busId: finalBusId,
        username,
        pseudo,
      });

      if (!joinResult.ok) {
        rooms.delete(room.id); // rollback si le join échoue
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
  // payload: { roomId, password, mapId, busId, username, pseudo }
  socket.on('joinRoom', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      if (!socket.user) {
        return ack({
          ok: false,
          error: 'Compte requis : connecte-toi (POST /api/login) avant de rejoindre une room.',
          code: 'AUTH_REQUIRED',
        });
      }

      const { roomId } = payload || {};
      if (!roomId) return ack({ ok: false, error: 'roomId requis.' });

      // Quitte la room courante si déjà dans une autre room
      if (currentRoomId && currentRoomId !== roomId) {
        leaveCurrentRoom();
      }

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
   */
  function joinRoomInternal(sock, roomId, { password, mapId, busId, username, pseudo, vehicleId, skinId }) {
    const room = rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room introuvable.' };

    if (room.players.size >= room.maxPlayers) {
      return { ok: false, error: 'Room pleine.' };
    }

    if (room.passwordHash || room.isPrivate) {
      if (room.passwordHash) {
        const providedOk = password && bcrypt.compareSync(password, room.passwordHash);
        if (!providedOk) return { ok: false, error: 'Mot de passe incorrect.' };
      }
    }

    // Vérification stricte de compatibilité map ET bus (les deux doivent
    // correspondre exactement à ce qu'attend la room, sinon les joueurs ne
    // verraient pas les mêmes véhicules/décors).
    if (mapId && String(mapId) !== room.mapId) {
      return {
        ok: false,
        error: `Incompatibilité de carte : la room exige mapId="${room.mapId}".`,
        code: 'MAP_MISMATCH',
      };
    }
    if (busId && String(busId) !== room.busId) {
      return {
        ok: false,
        error: `Incompatibilité de bus : la room exige busId="${room.busId}".`,
        code: 'BUS_MISMATCH',
      };
    }

    // L'identité authentifiée est TOUJOURS prioritaire sur ce que le client
    // prétend envoyer dans le payload — évite qu'un joueur usurpe le pseudo
    // d'un autre. Le payload ne sert de secours que si, un jour, un client
    // se connecte sans compte (actuellement bloqué en amont pour create/join).
    const finalUsername = String(sock.user?.username || sock.user?.pseudo || username || pseudo || `Joueur_${sock.id.slice(0, 5)}`)
      .trim()
      .slice(0, 24);

    const userId = sock.user?.id || genId('user');

    const player = {
      socketId: sock.id,
      userId,
      username: finalUsername,
      pseudo: finalUsername,
      // Mod de bus et skin choisis par le joueur, transmis aux autres membres
      // du salon pour qu'ils affichent le bon modèle/la bonne peinture.
      vehicleId: String(vehicleId || busId || 'bus_default'),
      skinId: String(skinId || 'default'),
      transform: null,
      lastUpdateTs: 0,
    };
    room.players.set(sock.id, player);
    sock.join(room.id);

    // Notifie les autres membres de la room
    sock.to(room.id).emit('playerJoined', {
      socketId: sock.id,
      userId: player.userId,
      username: player.username,
      pseudo: player.pseudo,
      vehicleId: player.vehicleId,
      skinId: player.skinId,
    });

    // Envoie l'état actuel de la room au nouvel arrivant (dont positions déjà connues)
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
          transform: p.transform,
        })),
    });

    return { ok: true, room: publicRoom(room) };
  }

  // -------------------- Démarrage du jeu (startGame) --------------------
  socket.on('startGame', (payload, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    try {
      if (!currentRoomId) {
        return ack({ ok: false, error: 'Vous n\'êtes dans aucune room.' });
      }

      const room = rooms.get(currentRoomId);
      if (!room) {
        return ack({ ok: false, error: 'Room introuvable.' });
      }

      if (room.hostId !== socket.id) {
        return ack({ ok: false, error: 'Seul l\'hôte peut démarrer la partie.' });
      }

      // Permet éventuellement de mettre à jour le mapId lors du lancement si précisé
      if (payload && payload.mapId) {
        room.mapId = String(payload.mapId).trim();
      }

      const pubRoom = publicRoom(room);

      // Émis à tous les membres de la room
      io.to(room.id).emit('GAME_STARTED', {
        mapId: room.mapId,
        room: pubRoom,
      });

      // Rétrocompatibilité avec l'événement gameStarted
      io.to(room.id).emit('gameStarted', {
        mapId: room.mapId,
        room: pubRoom,
      });

      return ack({ ok: true, message: 'Partie démarrée !', mapId: room.mapId, room: pubRoom });
    } catch (err) {
      console.error('[startGame] erreur:', err);
      return ack({ ok: false, error: 'Erreur serveur.' });
    }
  });

  // -------------------- Sortie volontaire de room --------------------
  socket.on('leaveRoom', (callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    leaveCurrentRoom();
    return ack({ ok: true });
  });

  function leaveCurrentRoom() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (room) {
      const leavingPlayer = room.players.get(socket.id);
      room.players.delete(socket.id);
      socket.leave(room.id);

      socket.to(room.id).emit('playerLeft', {
        socketId: socket.id,
        userId: leavingPlayer?.userId,
        username: leavingPlayer?.username || leavingPlayer?.pseudo,
      });

      if (room.players.size === 0) {
        rooms.delete(room.id); // nettoyage : room vide supprimée
      } else if (room.hostId === socket.id) {
        // Le créateur/hôte a quitté : transfert du rôle d'hôte au joueur suivant
        const nextHost = Array.from(room.players.values())[0];
        if (nextHost) {
          room.hostId = nextHost.socketId;
          const updatedRoom = publicRoom(room);

          // Diffusion de l'événement hostChanged
          io.to(room.id).emit('hostChanged', {
            newHostId: nextHost.socketId,
            newHostUsername: nextHost.username,
            newHostPseudo: nextHost.pseudo,
            room: updatedRoom,
          });
        }
      }
      io.emit('roomList', publicRoomList());
    }
    currentRoomId = null;
  }

  // -------------------- Synchronisation véhicule (30 Hz max) --------------------
  // Payload accepté :
  // {
  //   position: {x, y, z},
  //   rotation: {x, y, z, w},
  //   controls: { steerInput, throttle, brake, handbrake }  OU  steerInput, throttle, brake, handbrake à la racine
  // }
  socket.on('vehicleUpdate', (payload) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    // Throttle serveur : ignore si émis à une fréquence > 30 Hz (~33.3ms)
    if (now - player.lastUpdateTs < MIN_TICK_INTERVAL_MS) return;
    player.lastUpdateTs = now;

    if (!payload || typeof payload !== 'object') return;
    const { position, rotation, controls } = payload;
    if (!position || !rotation) return; // position et rotation obligatoires

    // Normalisation des commandes (embrayage/frein/accélérateur/direction)
    const ctrl = controls || {};
    const steerInput = Number(ctrl.steerInput ?? payload.steerInput) || 0;
    const throttle = Number(ctrl.throttle ?? payload.throttle) || 0;
    const brake = Number(ctrl.brake ?? payload.brake) || 0;
    const handbrake = Number(ctrl.handbrake ?? payload.handbrake) || 0;

    // Un joueur peut changer de mod de bus / de skin en cours de partie
    // (redémarrage du véhicule, changement de ligne...) : on met à jour son
    // état si ces champs sont fournis, sinon on garde la dernière valeur connue.
    if (payload.vehicleId) player.vehicleId = String(payload.vehicleId);
    if (payload.skinId) player.skinId = String(payload.skinId);

    // Indicateurs d'affichage purement informatifs (nametag, icône vocale) —
    // le serveur les relaie tels quels, sans logique dessus.
    const showNameTag = payload.showNameTag ?? true;
    const showVoiceIcon = payload.showVoiceIcon ?? false;
    const isTalking = payload.isTalking ?? false;

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
      controls: {
        steerInput,
        throttle,
        brake,
        handbrake,
      },
      steerInput,
      throttle,
      brake,
      handbrake,
      ts: now,
    };
    player.transform = transform;

    // Diffusion instantanée aux AUTRES membres du salon
    socket.to(room.id).volatile.emit('vehicleUpdate', {
      roomId: room.id,
      socketId: socket.id,
      userId: player.userId,
      username: player.username,
      pseudo: player.pseudo,
      vehicleId: player.vehicleId,
      skinId: player.skinId,
      position: transform.position,
      rotation: transform.rotation,
      controls: transform.controls,
      steerInput,
      throttle,
      brake,
      handbrake,
      showNameTag,
      showVoiceIcon,
      isTalking,
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
