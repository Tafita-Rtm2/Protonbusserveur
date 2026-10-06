
---

## 5. Relais allégé & P2P hybride (serveur peu chargé, 20 joueurs fluides)

**Relais (`relay.js`)** — le serveur garde le dernier état de chaque joueur et le diffuse dans une boucle de 40 ms (25 Hz) :
- **Delta** : un bus immobile n'est renvoyé qu'1 fois/s (keep-alive).
- **Distance** : < 250 m = chaque tick, 250–800 m = ~6 Hz, au-delà = 1 Hz (`RELAY_NEAR_M`, `RELAY_MID_M`, `RELAY_TICK_MS`).
- **Paquets légers** : `busInfo`, `skinPath`, `skinId`, `userId`, `roomId` ne sont envoyés qu'au 1er contact ou lors d'un changement. Le pseudo/username est toujours présent. Plus de `transform`/`controls` dupliqués ; positions arrondies au cm.
- **Groupé** : un seul encodage JSON par expéditeur et par tick. File d'envoi surveillée (`RELAY_MAX_BACKLOG`) pour ne pas accumuler de retard sur une connexion lente.
- `roomList` regroupé (max 1 envoi / 150 ms) ; compression WebSocket désactivée (CPU).
- Statistiques : `GET /api/relay-stats` (protégé comme les routes proxy), `RELAY_DEBUG=1` pour des logs.

**P2P (signalisation, le serveur reste le secours)** — réponses `createRoom`/`joinRoom` : champ `p2p: { enabled, stun[], udpPort, linkRefreshMs }`.
- `p2p:announce` `{ endpoints:[{ip,port}], nat }` → ack `{ ok, peers[], p2p }`, et `p2p:peer` diffusé aux autres.
- `p2p:signal` `{ to, data }` → relayé en `p2p:signal { from, data }` (négociation / hole punching).
- `p2p:links` `{ peers:[socketId...] }` à rafraîchir toutes les ~2 s. Quand **les deux** joueurs se déclarent liés, le serveur ne relaie plus entre eux (secours toutes les 3 s). Si un client cesse de rafraîchir (liaison coupée), le relais serveur reprend seul après 6 s.
- Désactivation : `P2P_ENABLED=false`.

**Reste à faire côté mod (`main.cpp`)** : socket UDP (port 8999), découverte d'adresse via STUN, `p2p:announce`, hole punching via `p2p:signal`, envoi/réception des positions en direct, puis `p2p:links`. Le serveur est prêt ; sans cette partie le jeu fonctionne comme avant, en plus léger.
