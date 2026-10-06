# SERVER.md — Guide d'optimisation & Prompts Serveur Multijoueur ProtonBusSync

Ce document contient le guide complet et les prompts pré-rédigés pour adapter le serveur principal Node.js / Socket.io (`server.js`) aux nouvelles fonctionnalités avancées (P2P relay, synchronisation des lumières/clignotants, hôte unique, migration d'hôte et clés d'activation administratives).

---

## 0. Compatibilité Ascendante & Rétrocompatibilité (Anciennes APKs)

- **Pas de plantage sur les anciennes APKs (`libmod.so`)** : Les paquets JSON de Socket.io autorisent la présence de nouveaux champs facultatifs (`headlight`, `turnLeft`, `turnRight`, `hazard`, `brake`, `reverse`, `busInfo`). Les versions antérieures de `libmod.so` ignorent simplement les champs inconnus sans crasher ni lever d'erreur.
- **Support hybride des clients** : Le serveur accepte les mises à jour `vehicleUpdate` envoyées par des clients plus anciens (qui ne contiennent pas les feux/clignotants) et applique des valeurs par défaut (`false`) sans rejeter le message.
- **Fonctionnalités Web & Site inchangées** : Les routes API existantes (`/api/rooms`, `/api/stats`, `/api/login`, `/api/register`) et l'interface Web Overlay (`public/overlay.html`) continuent de fonctionner à 100% sans aucune perturbation.

---

## 1. Fonctionnalités Serveur Nécessaires

### A. Authentification & Clés Unique Administrateur
- **Clés d'activation Administrateur** : Chaque compte ou création de salon doit vérifier la validité de la clé d'activation fournie (`activationKey` / `token`).
- Le serveur rejette toute création ou jonction si la clé est invalide ou déjà réutilisée illégalement.

### B. Gestion du Créateur de Salon & Migration d'Hôte (Host Migration)
- Chaque salon possède un propriétaire (`hostSocketId`).
- Si le créateur quitte le salon ou se déconnecte, le serveur désigne automatiquement le joueur suivant le plus ancien comme nouvel hôte (`roomHostChanged`).
- L'identifiant de salon (`roomId`) reste persistant et unique sur le serveur central.

### C. Relais P2P / Broadcast Léger (Positions, Lumières, Skins)
- Le serveur effectue un broadcast direct et optimisé (sans sérialisation lourde) des paquets `vehicleUpdate` vers tous les autres membres du salon via Socket.io (`socket.to(roomId).emit("vehicleUpdate", data)`).
- **Champs relayés** :
  - `socketId`, `pseudo`, `vehicleId`, `skinPath`
  - `position` `{x, y, z}`, `rotation` `{x, y, z, w}`
  - `headlight`, `turnLeft`, `turnRight`, `hazard`, `brake`, `reverse` (booléens d'éclairage)
  - `showNameTag`, `showVoiceIcon`, `isTalking`
  - `busInfo` (métadonnées complètes du modèle/skin)

---

## 2. Prompt à fournir à l'IA / Développeur Serveur

Si vous souhaitez mettre à jour directement votre fichier `server.js`, vous pouvez copier-coller le prompt suivant :

```markdown
Mets à jour mon serveur Node.js Socket.io (server.js) pour le multijoueur ProtonBusSync avec les spécifications suivantes :

1. Stockage des salons :
   - Maintenir une Map des salons `rooms` : `roomId => { id, name, mapId, hostSocketId, players: Map(socketId => playerObj) }`.

2. Validation des clés d'activation administratives :
   - Vérifier l'en-tête/token ou le paramètre `activationKey` lors des événements `createRoom` et `joinRoom`. Refuser avec `{ ok: false, error: "INVALID_KEY" }` si non valide.

3. Hôte du salon & Migration automatique :
   - Lors de la création d'un salon (`createRoom`), `hostSocketId` est défini avec le socket courant.
   - Si le créateur quitte le salon (`disconnect` ou `leaveRoom`), attribuer immédiatement `hostSocketId` au premier joueur restant dans `room.players`.
   - Émettre un événement `roomHostChanged` à tous les membres de la room avec `{ newHostSocketId, newHostPseudo }`.

4. Broadcast des véhicules à 30 Hz (vehicleUpdate) :
   - Relayer fidèlement et sans altération les champs :
     `socketId`, `pseudo`, `vehicleId`, `skinId`, `position`, `rotation`, `headlight`, `turnLeft`, `turnRight`, `hazard`, `brake`, `reverse`, `showNameTag`, `showVoiceIcon`, `isTalking`, et `busInfo`.
   - Utiliser `socket.to(roomId).emit("vehicleUpdate", data)` pour minimiser la latence réseau.

5. Événements `playerJoined`, `playerLeft` et `roomState` :
   - À chaque jonction/départ, mettre à jour l'état de la room et informer tous les membres du salon en temps réel.

6. Rétrocompatibilité universelle :
   - Ne jamais rejeter un paquet `vehicleUpdate` s'il lui manque les nouveaux champs d'éclairage. Remplacer les champs manquants par leurs valeurs par défaut (`headlight: false`, `turnLeft: false`, etc.) pour maintenir la compatibilité fluide avec toutes les versions d'APK.
```

---

## 3. Exemple d'Implémentation dans `server.js`

```javascript
// Migration d'hôte lors d'une déconnexion
function handlePlayerLeave(socket) {
    const roomId = socket.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    const room = rooms.get(roomId);
    room.players.delete(socket.id);

    // Notification du départ
    socket.to(roomId).emit("playerLeft", { socketId: socket.id });

    if (room.players.size === 0) {
        rooms.delete(roomId);
    } else if (room.hostSocketId === socket.id) {
        // Migration vers le premier joueur restant
        const newHostId = room.players.keys().next().value;
        const newHost = room.players.get(newHostId);
        room.hostSocketId = newHostId;

        io.to(roomId).emit("roomHostChanged", {
            newHostSocketId: newHostId,
            newHostPseudo: newHost.pseudo
        });
    }
}
```

---

## 4. Anti-doublons de joueurs (correctif compteur 2/10, 4/10)

**Symptôme** : à la création d'un salon le compteur affichait 2/10, et un clic sur « Rejoindre » pouvait donner 4/10.
**Cause** : le jeu ouvre parfois une 2e connexion socket (ou se reconnecte) alors que l'ancienne connexion « fantôme » est encore dans le salon ; chaque socket était compté comme un joueur distinct.

**Correctifs dans `server.js`** :
- `joinRoom` est idempotent : un joueur déjà présent n'est pas recompté ni ré-annoncé (le `roomState` est simplement renvoyé).
- Une nouvelle connexion d'un même joueur (même clé d'activation, même compte, même `deviceId`/`clientId`, ou même pseudo + même IP pour les invités) remplace l'ancienne session (`duplicateSession` envoyé à l'ancienne, `playerLeft` diffusé). Si l'ancienne session était l'hôte, l'hôte est transféré à la nouvelle (`roomHostChanged`), le salon n'est pas supprimé.
- Verrou par socket sur `createRoom`/`joinRoom` contre les doubles clics (réponse `code: "BUSY"`).
- Balayage toutes les 15 s des sockets fantômes + migration d'hôte automatique.
- `maxPlayers` par défaut passé de 10 à 20.
- Champ optionnel `deviceId` (ou `clientId`) accepté dans `createRoom`/`joinRoom` pour une identification fiable côté APK.
