---
title: Proton Bus Multiplayer Server
emoji: 🚌
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Proton Bus Simulator — Serveur Multijoueur

Serveur Node.js (Express + Socket.io) pour le multijoueur temps réel de Proton
Bus Simulator : authentification (compte obligatoire), salons (rooms) avec
contrôle strict de compatibilité map/bus, et synchronisation de position à
30 ticks/sec max.

Ce dépôt se synchronise automatiquement vers le Space Hugging Face
(Space privé, non nommé ici) à chaque push sur `main`, via
`.github/workflows/deploy-to-hf.yml`.

## Structure (v2)

- `server.js` — serveur Express + Socket.io : comptes, rooms, modération (kick/ban/fermeture), chat, signalisation vocale
- `db.js` — comptes en PostgreSQL (`DATABASE_URL`), repli JSON si absent
- `web/` — interface Next.js (Vercel) : connexion, lobby, room, vocal
- `test/smoke.js` — tests de bout en bout du serveur
- `public/` — ancien dashboard de test (désactivé par défaut, `ENABLE_DASHBOARD=true`)
- `DEPLOY.md` — **guide de déploiement complet et notes de sécurité**

Voir `GUIDE-APK.md` pour l'installation du mod côté APK.
