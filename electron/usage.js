// Registro dei consumi: una riga JSON per richiesta in app/data/usage.jsonl
const fs = require('fs');
const path = require('path');

function file(appDir) { return path.join(appDir, 'data', 'usage.jsonl'); }

function record(appDir, entry) {
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
  fs.appendFileSync(file(appDir), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', 'utf8');
}

function list(appDir) {
  if (!fs.existsSync(file(appDir))) return [];
  return fs.readFileSync(file(appDir), 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

module.exports = { record, list };
