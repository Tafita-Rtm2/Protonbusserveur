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
(`Tafitaniaina/TVserveur`) à chaque push sur `main`, via
`.github/workflows/deploy-to-hf.yml`.

## Fichiers principaux

- `server.js` — serveur Express + Socket.io (API REST, rooms, auth)
- `db.js` — persistance simple des comptes (fichier JSON local)
- `public/index.html` — dashboard de test (comptes, rooms, logs Socket.io)
- `public/launcher.html` — page servie au Launcher Android externe
- `Dockerfile` — build du conteneur pour Hugging Face Spaces (port 7860)

Voir `GUIDE-APK.md` pour l'installation du mod côté APK.
