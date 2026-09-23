const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'users.json');

/**
 * Charge les utilisateurs depuis le fichier JSON.
 * @returns {Map<string, {id: string, username: string, pseudo: string, passwordHash: string, createdAt: number}>}
 */
function loadUsers() {
  const users = new Map();
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      const list = JSON.parse(data);
      if (Array.isArray(list)) {
        for (const user of list) {
          const key = (user.username || user.pseudo || '').trim().toLowerCase();
          if (key) {
            users.set(key, {
              id: user.id,
              username: user.username || user.pseudo,
              pseudo: user.pseudo || user.username,
              passwordHash: user.passwordHash,
              createdAt: user.createdAt || Date.now(),
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[DB] Erreur de lecture users.json:', err.message);
  }
  return users;
}

/**
 * Sauvegarde la Map des utilisateurs dans le fichier JSON.
 * @param {Map<string, Object>} usersMap
 */
function saveUsers(usersMap) {
  try {
    const list = Array.from(usersMap.values());
    fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Erreur d\'écriture users.json:', err.message);
  }
}

module.exports = {
  loadUsers,
  saveUsers,
};
