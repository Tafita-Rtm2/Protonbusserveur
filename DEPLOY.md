# Déploiement — Proton Bus v2

Architecture :

```
Navigateur ──► Site Next.js (Vercel) ──► /api/proxy/*  ──► Serveur Hugging Face (REST : comptes)
     │                                                        ▲
     └──────── WebSocket Socket.io (après connexion) ─────────┘   ◄── Mod du jeu (Socket.io)
     └──────── Audio vocal : WebRTC pair-à-pair entre joueurs
```

## 1. Base de données des comptes (gratuit)
1. Crée un projet sur **https://neon.tech** (ou Supabase) → copie la *connection string* PostgreSQL.
2. C'est ta `DATABASE_URL`. Les tables sont créées automatiquement au démarrage du serveur.
   Les anciens comptes de `users.json` sont importés automatiquement s'il en reste.

## 2. Serveur — Hugging Face Space (Secrets)
*Settings → Variables and secrets → New secret* :

| Secret | Valeur |
|---|---|
| `JWT_SECRET` | longue chaîne aléatoire (`openssl rand -hex 48`) — **obligatoire** |
| `DATABASE_URL` | la connection string Neon |
| `API_PROXY_KEY` | chaîne aléatoire (`openssl rand -hex 32`) — la même sur Vercel |
| `ALLOWED_ORIGINS` | `https://ton-site.vercel.app` (plusieurs : séparées par des virgules) |
| `REQUIRE_AUTH` | *laisser vide pour l'instant* (voir §5) |
| `ICE_SERVERS` | *(optionnel)* JSON STUN/TURN pour le vocal |

## 3. Site — Vercel
1. *Add New Project* → importe ce dépôt → **Root Directory : `web`**.
2. Variables d'environnement (Production) :
   - `GAME_SERVER_URL` = `https://tafitaniaina-tvserveur.hf.space` (URL du Space)
   - `API_PROXY_KEY` = la même valeur que sur le Space
3. Déploie. Ne mets **jamais** ces variables avec le préfixe `NEXT_PUBLIC_`.

## 4. Mettre en ligne
Fusionne la branche `next-interface` dans `main` : le workflow GitHub synchronise automatiquement le Space.

## 5. Activer « compte obligatoire » pour tout le monde (mod inclus)
Tant que le mod n'envoie pas de token, `REQUIRE_AUTH` doit rester vide, sinon il ne pourra plus se connecter.
Quand le mod sera mis à jour :
1. Le mod se connecte via `POST https://ton-site.vercel.app/api/proxy/login` `{ "username": "...", "password": "..." }` → reçoit `token`.
2. Il ouvre Socket.io avec `auth: { token }` (le pseudo du compte est alors imposé par le serveur).
3. Mets `REQUIRE_AUTH=true` sur le Space.

## Sécurité — ce qui est (et n'est pas) possible
**En place :** mots de passe bcrypt, JWT signé, blocage après 8 échecs, limitation de débit, CORS limité à ton site,
routes de comptes invisibles hors proxy Vercel (404), URL du serveur absente du code du site et révélée
uniquement après connexion, en-têtes de sécurité (Helmet), tailles de messages limitées, dashboard public désactivé,
kick/ban/fermeture réservés au créateur côté serveur.

**Limite à connaître :** Vercel ne gère pas les WebSockets, donc le navigateur d'un joueur *connecté* doit contacter
le serveur Socket.io directement : son URL est donc visible dans l'onglet Réseau de ce joueur. Et un Space Hugging Face
gratuit est public. On ne peut pas la cacher à 100 % ; la vraie protection est l'authentification :
avec `REQUIRE_AUTH=true`, connaître l'URL ne sert à rien sans compte valide.

## Vocal
Audio WebRTC pair-à-pair (maillage) : idéal jusqu'à ~8 personnes en vocal simultané. Le STUN Google est inclus ;
pour les réseaux mobiles/NAT stricts, ajoute un serveur TURN via `ICE_SERVERS`, par exemple :
`[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:mon-turn:3478","username":"u","credential":"p"}]`

## Tests
`npm install && npm test` dans la racine lance 39 vérifications du serveur (comptes, rooms, ban, vocal, etc.).
