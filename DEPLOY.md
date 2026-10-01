# Déploiement — Proton Bus v2

Architecture :

```
Navigateur ─┐
            ├──► Site Next.js (Vercel) ──► relais /api + /socket.io (+ secrets) ──► Serveur Hugging Face ──► Supabase
Jeu (APK) ──┘      seule URL connue                                                    (répond 404 sans secret)
Vocal : WebRTC pair-à-pair entre joueurs
```

## 1. Base de données des comptes — Supabase
1. Supabase → **SQL Editor → New query** → colle le contenu de `supabase/schema.sql` → **Run** (une seule fois).
   La table `users` est protégée (RLS, aucune policy) : la clé publique ne peut rien lire, seul le serveur (SECRET KEY) le peut.
2. Les anciens comptes de `users.json` sont importés automatiquement s'il en reste.
3. Au démarrage, le log doit afficher `[DB] Supabase connecté ✔`.

## 2. Serveur — Hugging Face Space (Secrets)
Copie les lignes du fichier `.env` (modèle : `hf-space.env`) dans *Settings → Variables and secrets*.
Indispensables : `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, `API_PROXY_KEY`, `SOCKET_PATH_KEY`.
Laisse `REQUIRE_AUTH` vide pour l'instant (§5).

## 3. Site — Vercel
1. *Add New Project* → importe ce dépôt → **Root Directory : `web`**.
2. Variables (modèle : `vercel.env`) : `GAME_SERVER_URL`, `API_PROXY_KEY`, `SOCKET_PATH_KEY` — **sans** `NEXT_PUBLIC_`.
3. Déploie, puis (re)déploie si tu changes une variable (elles sont lues au build).

## 4. Brancher le jeu sur Vercel (et plus jamais sur Hugging Face)
- Dans l'APK / Launcher, l'adresse de la page chargée devient `https://ton-site.vercel.app/launcher`
  (le site sert `/launcher` : c'est l'ancien index.html, refait).
- Le site transmet au jeu `serverUrl = https://ton-site.vercel.app` : le jeu se connecte donc à Vercel,
  qui relaie `/socket.io` vers Hugging Face en insérant le chemin secret.
- Le client Socket.io du jeu doit pouvoir utiliser le **long-polling** (réglage par défaut : polling puis upgrade).
  Un client forcé en WebSocket seul ne marchera pas via Vercel.

## 5. Activer « compte obligatoire » pour tout le monde (jeu inclus)
Tant que le jeu n'envoie pas de token, `REQUIRE_AUTH` reste vide. Quand le jeu sera mis à jour :
1. Le jeu appelle `POST https://ton-site.vercel.app/api/proxy/login` → reçoit `token`.
2. Il ouvre Socket.io (sur l'URL du site) avec `auth: { token }`.
3. Mets `REQUIRE_AUTH=true` sur le Space.

## Sécurité — ce qui est en place
- **L'URL Hugging Face ne sert plus à rien** : sans `API_PROXY_KEY`, toutes les routes `/api` répondent 404 ;
  Socket.io n'existe que sur un chemin secret. Navigateur et jeu ne connaissent que l'URL Vercel
  (vérifié : aucune trace de l'URL ni des clés dans le JavaScript du site).
- Mots de passe bcrypt, JWT signé, blocage après 8 échecs, limitation de débit, Helmet, messages limités,
  kick/ban/fermeture réservés au créateur côté serveur, dashboard public désactivé.
- Limite honnête : le Space est public sur huggingface.co (son code est visible) ; la protection repose sur les secrets,
  qui ne sont jamais dans le dépôt. Ne mets jamais `.env` sur GitHub et régénère une clé si elle fuite.

## Contrepartie de Vercel : le temps réel passe en long-polling
Vercel ne gère pas les WebSockets. Les positions des bus (`vehicleUpdate`, 30 Hz) transitent donc par des requêtes HTTP :
plus de latence et un peu de perte par rapport à un WebSocket direct (mesure locale : ~77 % reçus à 30 Hz, avant latence réseau).
Le mod doit interpoler les positions. Surveille aussi les quotas gratuits de Vercel si beaucoup de joueurs.

## Vocal
Audio WebRTC pair-à-pair (maillage) : idéal jusqu'à ~8 personnes. STUN Google inclus ; pour les réseaux mobiles stricts,
ajoute un TURN via `ICE_SERVERS`. Dans la WebView Android, le micro exige que l'APK déclare la permission
`RECORD_AUDIO` et accepte `onPermissionRequest` ; sinon le vocal fonctionnera dans un navigateur mais pas dans le Launcher.

## Tests
`npm install && npm test` : 52 vérifications (serveur, verrouillage, mode Supabase simulé).
