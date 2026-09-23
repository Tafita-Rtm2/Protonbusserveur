FROM node:20-slim

# Hugging Face Spaces exécute le conteneur avec un utilisateur non-root par défaut.
# On prépare un répertoire de travail accessible en écriture pour tout le monde,
# ce qui évite les erreurs de permissions au runtime.
WORKDIR /app

# Installer les dépendances d'abord (meilleur cache Docker)
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copier le reste du code
COPY . .

# Hugging Face Spaces impose le port 7860
ENV PORT=7860
ENV NODE_ENV=production

# Rendre le répertoire accessible à l'utilisateur runtime imposé par HF (UID 1000)
RUN chmod -R 777 /app

EXPOSE 7860

CMD ["node", "server.js"]
