'use strict';
/**
 * relay.js — Relais "léger" des vehicleUpdate pour ProtonBusSync (jusqu'à 20+ joueurs / room).
 *
 * Idée : au lieu de rediffuser immédiatement chaque paquet reçu à 30 Hz vers tous les joueurs,
 * le serveur garde le DERNIER état de chaque joueur et le diffuse dans une boucle régulière
 * (RELAY_TICK_MS, 40 ms = 25 Hz) en économisant tout ce qui est inutile :
 *
 *  1. DELTA        : un bus immobile / inchangé n'est renvoyé qu'1 fois par seconde (keep-alive).
 *  2. DISTANCE     : joueur proche (< NEAR) = chaque tick ; moyen = ~6 Hz ; lointain = 1 Hz.
 *  3. PAQUET LÉGER : les infos lourdes (skin, busInfo, userId...) ne sont envoyées qu'au premier
 *                    paquet reçu par un joueur ou quand elles changent ; plus de champs dupliqués
 *                    (transform/controls) ; positions arrondies (cm) => JSON beaucoup plus court.
 *  4. GROUPÉ       : un seul encodage par expéditeur et par tick (io.to([ids])), pas un par destinataire.
 *  5. P2P          : si deux joueurs déclarent une liaison directe (p2p:links) des DEUX côtés,
 *                    le serveur ne relaie presque plus entre eux (secours toutes les 3 s).
 *
 * Compatibilité : l'événement reste "vehicleUpdate" avec les mêmes noms de champs que avant
 * (socketId, pseudo, username, vehicleId, position, rotation, feux, showNameTag...).
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TICK_MS = clamp(Number(process.env.RELAY_TICK_MS) || 40, 20, 200);
const NEAR_M = Number(process.env.RELAY_NEAR_M) || 250;
const MID_M = Number(process.env.RELAY_MID_M) || 800;
const MID_INTERVAL_MS = 160;
const FAR_INTERVAL_MS = 1000;
const KEEPALIVE_MS = 1000;
const LINKED_KEEPALIVE_MS = 3000;
const LINK_TTL_MS = 6000;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

function createRelay({ io, rooms }) {
  const stats = { ticks: 0, sent: 0, skippedUnchanged: 0, skippedThrottle: 0, skippedP2p: 0, droppedSlow: 0, received: 0, changed: 0 };

  /** Appelé à chaque vehicleUpdate VALIDÉ reçu d'un joueur. Ne diffuse rien : met juste l'état à jour. */
  function update(room, player, f) {
    stats.received++;
    const st = player.relay || (player.relay = {
      ver: 0, busVer: 0, sig: '', busSig: '', lean: null, full: null, pos: null, to: new Map(),
    });

    const position = { x: r2(f.position.x), y: r2(f.position.y), z: r2(f.position.z) };
    const rotation = { x: r4(f.rotation.x), y: r4(f.rotation.y), z: r4(f.rotation.z), w: r4(f.rotation.w) };
    const steerInput = r2(f.steerInput);
    const throttle = r2(f.throttle);
    const handbrake = r2(f.handbrake);

    const sig = [
      position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w,
      steerInput, throttle, handbrake,
      +f.headlight, +f.turnLeft, +f.turnRight, +f.hazard, +f.brake, +f.reverse,
      String(f.showNameTag), String(f.showVoiceIcon), String(f.isTalking),
    ].join(',');

    const busSig = `${player.vehicleId}|${player.skinId}|${player.skinPath}|${player.busInfo ? JSON.stringify(player.busInfo) : ''}`;
    let rebuild = false;

    if (busSig !== st.busSig) { st.busSig = busSig; st.busVer++; rebuild = true; }
    if (sig !== st.sig) { st.sig = sig; st.ver++; stats.changed++; rebuild = true; }
    st.pos = position;
    if (!rebuild && st.lean) return;

    const common = {
      position, rotation,
      steerInput, throttle, handbrake,
      headlight: !!f.headlight, turnLeft: !!f.turnLeft, turnRight: !!f.turnRight,
      hazard: !!f.hazard, brake: !!f.brake, reverse: !!f.reverse,
      showNameTag: f.showNameTag, showVoiceIcon: f.showVoiceIcon, isTalking: f.isTalking,
    };
    // Paquet léger : identité minimale (le pseudo reste présent pour l'affichage du nom).
    st.lean = { socketId: player.socketId, username: player.username, pseudo: player.pseudo, vehicleId: player.vehicleId, ...common };
    // Paquet complet : identique à l'ancien format (skin, busInfo...), envoyé au 1er contact et sur changement.
    st.full = {
      roomId: room.id, socketId: player.socketId, userId: player.userId,
      username: player.username, pseudo: player.pseudo,
      vehicleId: player.vehicleId, skinId: player.skinId, skinPath: player.skinPath,
      ...(player.busInfo ? { busInfo: player.busInfo } : {}),
      ...common,
    };
  }

  function linked(a, b, now) {
    const la = a.p2p && a.p2p.links && a.p2p.links.get(b.socketId);
    const lb = b.p2p && b.p2p.links && b.p2p.links.get(a.socketId);
    return !!(la && lb && now - la < LINK_TTL_MS && now - lb < LINK_TTL_MS);
  }

  function intervalFor(a, b) {
    const pa = a.relay && a.relay.pos;
    const pb = b.relay && b.relay.pos;
    if (!pa || !pb) return 0;
    const dx = pa.x - pb.x, dy = pa.y - pb.y, dz = pa.z - pb.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= NEAR_M * NEAR_M) return 0;               // proche : à chaque tick
    if (d2 <= MID_M * MID_M) return MID_INTERVAL_MS;   // moyen
    return FAR_INTERVAL_MS;                            // lointain
  }

  // Envoi NON volatil : plusieurs paquets d'affilée vers un même joueur dans un tick doivent tous partir
  // (un envoi "volatile" est jeté si une écriture est déjà en cours). Pour ne pas accumuler de retard sur
  // une connexion lente, on saute les destinataires dont la file d'envoi est déjà trop pleine.
  const MAX_BACKLOG = Number(process.env.RELAY_MAX_BACKLOG) || 40;
  function sendTo(ids, payload) {
    if (!ids.length) return;
    const ok = [];
    for (const id of ids) {
      const sock = io.sockets.sockets.get(id);
      if (!sock) continue;
      const wb = sock.conn && sock.conn.writeBuffer;
      if (wb && wb.length > MAX_BACKLOG) { stats.droppedSlow++; continue; }
      ok.push(id);
    }
    if (!ok.length) return;
    stats.sent += ok.length;
    io.to(ok.length === 1 ? ok[0] : ok).emit('vehicleUpdate', payload);
  }

  function tick() {
    const now = Date.now();
    stats.ticks++;
    for (const room of rooms.values()) {
      if (room.players.size < 2) continue;
      for (const s of room.players.values()) {
        const st = s.relay;
        if (!st || !st.lean) continue;
        const leanIds = [];
        const fullIds = [];

        for (const r of room.players.values()) {
          if (r === s) continue;
          let rec = st.to.get(r.socketId);
          if (!rec) { rec = { ver: -1, busVer: -1, ts: 0 }; st.to.set(r.socketId, rec); }
          const needFull = rec.busVer !== st.busVer;
          const changed = rec.ver !== st.ver;
          const age = now - rec.ts;

          if (!needFull) {
            if (!changed && age < KEEPALIVE_MS) { stats.skippedUnchanged++; continue; }
            if (linked(s, r, now) && age < LINKED_KEEPALIVE_MS) { stats.skippedP2p++; continue; }
            if (changed && age < intervalFor(s, r)) { stats.skippedThrottle++; continue; }
          }
          rec.ver = st.ver;
          rec.ts = now;
          if (needFull) { rec.busVer = st.busVer; fullIds.push(r.socketId); } else { leanIds.push(r.socketId); }
        }

        sendTo(fullIds, st.full);
        sendTo(leanIds, st.lean);

        if (st.to.size > room.players.size + 4) {
          for (const id of st.to.keys()) if (!room.players.has(id)) st.to.delete(id);
        }
      }
    }
  }

  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  if (process.env.RELAY_DEBUG) setInterval(() => console.log('[relay]', JSON.stringify(stats)), 2000).unref();

  /** p2p:links — le client liste les pairs avec lesquels il a une liaison directe ACTIVE (à rafraîchir toutes les ~2 s). */
  function setLinks(player, ids) {
    const now = Date.now();
    const links = new Map();
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 32)) {
      if (typeof id === 'string' && id.length <= 64) links.set(id, now);
    }
    player.p2p = player.p2p || {};
    player.p2p.links = links;
  }

  return { update, tick, setLinks, linked, stats: () => ({ ...stats, tickMs: TICK_MS }) };
}

module.exports = { createRelay, TICK_MS };
