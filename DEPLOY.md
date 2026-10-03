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
Copie les lignes de `hf-space.env` dans *Settings → Variables and secrets* :
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, `API_PROXY_KEY`, `ALLOWED_ORIGINS`.

> ℹ️ **`SOCKET_PATH_KEY` est désormais ignoré par le serveur** (inutile de l'ajouter ; s'il est déjà dans les Secrets il ne gêne plus). Le mod du jeu (`libmod.so`) a l'adresse `tafitaniaina-tvserveur.hf.space`
> et le chemin `/socket.io` **codés en dur** (WebSocket brut, sans token). Déplacer ce chemin faisait fermer les WebSocket du mod sans réponse,
> ce que le proxy Hugging Face affiche en `502 Bad Gateway` (logs « Upgrade WebSocket refusé… 502 »).
> Laisse aussi `REQUIRE_AUTH` absent (le mod n'envoie pas de compte).

## 3. Site — Vercel
Root Directory **`web`**, variables (`vercel.env`) : `GAME_SERVER_URL`, `API_PROXY_KEY` (sans `NEXT_PUBLIC_`).
Le site relaie `/api` et `/socket.io` vers le Space (long-polling) : navigateur ⇄ Vercel ⇄ Hugging Face.

## 4. Comment le jeu et le site se parlent
- Le **menu** (créer / rejoindre, vocal, chat…) peut être celui du site Vercel : l'APK charge `https://protonbusserveur.vercel.app/launcher`.
- Au lancement, le menu appelle `AndroidHost.launchGame(...)` et **le mod ouvre sa propre connexion directe vers Hugging Face**
  (adresse codée dans le mod, il ignore `serverUrl`). Les voitures passent donc par cette connexion directe.
- Le serveur n'envoie au mod **que les événements d'origine** (`roomState`, `playerJoined`, `playerLeft`, `vehicleUpdate`, …).
  Les événements du site (membres, chat, vocal, bans) ne vont qu'aux clients web : test `test/mod-compat.js`.

## Sécurité — ce qui est (et n'est pas) possible
- **En place :** mots de passe bcrypt, JWT, blocage anti brute-force, limitation de débit, Helmet, tailles limitées,
  kick/ban/fermeture réservés au créateur côté serveur, routes `/api` cachées hors Vercel (`API_PROXY_KEY`),
  comptes dans Supabase protégés par RLS.
- **Limite :** l'adresse Hugging Face **ne peut pas être cachée au jeu** tant que le mod est compilé avec elle en dur
  et parle en WebSocket (Vercel ne les relaie pas). Elle reste donc extractible de l'APK. Pour la cacher il faudrait
  recompiler le mod avec un serveur WebSocket intermédiaire (autre hébergeur que Vercel).
- Le Space est public sur huggingface.co ; les secrets ne sont jamais dans le dépôt.

## Vocal
Audio WebRTC pair-à-pair (maillage) : idéal jusqu'à ~8 personnes. STUN Google inclus ; pour les réseaux mobiles stricts,
ajoute un TURN via `ICE_SERVERS`. Dans la WebView Android, le micro exige que l'APK déclare la permission
`RECORD_AUDIO` et accepte `onPermissionRequest` ; sinon le vocal fonctionnera dans un navigateur mais pas dans le Launcher.

## Tests
`npm install && npm test` : 63 vérifications (serveur, verrouillage, Supabase simulé, **compatibilité du mod natif**).
