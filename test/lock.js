/* Vérifie le verrouillage : l'URL Hugging Face seule ne doit rien donner. */
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const PORT = 7863, URL = `http://127.0.0.1:${PORT}`, KEY = 'proxykey', SK = 'sec123abc';
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✔', m); } else { failed++; console.log('  ✘ FAIL:', m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (p, h = {}) => fetch(URL + p, { headers: h }).then((r) => r.status);
const tryConnect = (path) => new Promise((res) => {
  const s = io(URL, { path, transports: ['polling'], reconnection: false, timeout: 2500 });
  s.on('connect', () => { s.close(); res(true); });
  s.on('connect_error', () => { s.close(); res(false); });
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 30000).unref();
(async () => {
  require('fs').rmSync('/tmp/users.json', { force: true });
  const srv = spawn('node', ['server.js'], { env: { ...process.env, DOTENV_CONFIG_PATH: '/nonexistent', PORT, API_PROXY_KEY: KEY, SOCKET_PATH_KEY: SK, JWT_SECRET: 'z'.repeat(40), DATA_DIR: '/tmp' }, stdio: 'ignore' });
  await sleep(1200);
  console.log('Verrouillage');
  ok(await status('/api/rooms') === 404, '/api/rooms sans clé => 404');
  ok(await status('/api/health') === 404, '/api/health sans clé => 404');
  ok(await status('/api/rooms', { 'x-proxy-key': KEY }) === 200, '/api/rooms avec clé => 200');
  ok(await tryConnect('/socket.io') === true, 'SOCKET_PATH_KEY défini mais IGNORÉ : /socket.io fonctionne (le mod en a besoin)');
  ok(await tryConnect(`/${SK}/socket.io`) === false, 'aucun chemin secret n\'est exposé');
  srv.kill();
  console.log(`\n${passed} OK, ${failed} échec(s)`);
  process.exit(failed ? 1 : 0);
})();
