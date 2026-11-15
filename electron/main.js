// Studio Agent - processo principale di Electron
const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const songs = require('./songs');
const usage = require('./usage');
const claude = require('./claude');

const APP_DIR = path.resolve(__dirname, '..');            // codice dell'app (dentro l'installazione)
const DATA_DIR = app.getPath('userData');                   // dati utente: impostazioni, consumi, limiti
const SETTINGS = path.join(DATA_DIR, 'settings.json');

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function settings() { return readJson(SETTINGS, {}); }
function saveSettings(s) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2)); }

function isProject(dir) { return !!dir && fs.existsSync(path.join(dir, '.claude', 'agents')); }

/** Cartella studio-agent: variabile d'ambiente, impostazione salvata, cartella sopra l'app (sviluppo), percorso abituale. */
function resolveRoot() {
  const candidates = [process.env.STUDIO_AGENT_ROOT, settings().root, path.resolve(APP_DIR, '..'),
    path.join(os.homedir(), 'Music', 'Didattica', 'studio-agent')];
  return candidates.find(isProject) || '';
}
let ROOT = resolveRoot();

function config() {
  const def = { claudeCommand: 'claude', pythonCommand: process.platform === 'win32' ? 'python' : 'python3' };
  return { ...def, ...readJson(path.join(APP_DIR, 'config.json'), {}), ...(settings().commands || {}) };
}

async function chooseRoot(parent) {
  const r = await dialog.showOpenDialog(parent, {
    title: 'Scegli la cartella studio-agent', properties: ['openDirectory'],
    message: 'La cartella che contiene .claude\\agents, songs e tools',
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, root: ROOT };
  const dir = r.filePaths[0];
  if (!isProject(dir)) return { ok: false, root: ROOT, message: `In ${dir} non trovo .claude\\agents: scegli la cartella studio-agent.` };
  ROOT = dir;
  saveSettings({ ...settings(), root: dir });
  return { ok: true, root: dir };
}

let win;
const running = new Map();

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600, backgroundColor: '#121315', title: 'Studio Agent',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(APP_DIR, 'ui-dist', 'browser', 'index.html'));
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

function inside(p) { const r = path.resolve(p); return r === ROOT || r.startsWith(ROOT + path.sep); }

ipcMain.handle('info', () => ({ root: ROOT, hasAgents: isProject(ROOT), version: app.getVersion() }));
ipcMain.handle('settings:chooseRoot', () => chooseRoot(win));
ipcMain.handle('songs:list', () => songs.listSongs(ROOT));
ipcMain.handle('songs:create', (_e, data) => songs.createSong(ROOT, data));
ipcMain.handle('songs:decision', (_e, song, agent, text) => songs.addDecision(ROOT, song, agent, text));
ipcMain.handle('songs:version', (_e, song, v) => songs.addVersion(ROOT, song, v));
ipcMain.handle('usage:list', () => usage.list(DATA_DIR));
ipcMain.handle('usage:limits', () => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'limits.json'), 'utf8')); } catch { return null; } });
ipcMain.handle('open:path', (_e, p) => (inside(p) ? shell.openPath(p) : 'Percorso fuori dalla cartella del progetto'));

ipcMain.handle('audio:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Scegli un file audio', properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['wav', 'flac', 'aiff', 'aif'] }] });
  return r.canceled ? null : r.filePaths[0];
});

function runPy(args) {
  return new Promise((resolve) => {
    const child = spawn(config().pythonCommand, args, { cwd: ROOT, windowsHide: true });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => resolve({ code: -1, out: '', err: 'Python non trovato: installa Python o indica il comando in app/config.json' }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
function lastLine(t) { return String(t).trim().split(/\r?\n/).filter(Boolean).pop() || ''; }

ipcMain.handle('songs:progression', (_e, song, prog, sec) => songs.setProgression(ROOT, song, prog, sec));
ipcMain.handle('songs:type', (_e, song, type) => songs.setBriefField(ROOT, song, 'Tipo di composizione', type));

ipcMain.handle('harmony:midi', async (_e, { song, progression, bpm, key, name }) => {
  const base = String(name || 'progression').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'progression';
  const dir = song ? path.join(ROOT, 'songs', song, 'midi') : path.join(ROOT, 'midi');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, base + '.mid');
  const args = [path.join(ROOT, 'tools', 'prog2midi.py'), progression, '-o', out, '--title', song || base];
  if (bpm) args.push('--bpm', String(bpm));
  if (key) args.push('--key', key);
  const r = await runPy(args);
  if (r.code !== 0) return { ok: false, message: lastLine(r.err) || lastLine(r.out) || 'Esportazione non riuscita' };
  return { ok: true, path: out, message: r.out.trim() };
});

// Realizzazione a quattro voci (tools/satb.py): voci in JSON e, se richiesto, MusicXML + MIDI in score/
ipcMain.handle('harmony:satb', async (_e, { song, progression, bpm, key, name, write }) => {
  const args = [path.join(ROOT, 'tools', 'satb.py'), progression, '--json'];
  if (key) args.push('--key', key);
  if (bpm) args.push('--bpm', String(bpm));
  if (write) {
    const base = String(name || 'progression-satb').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'progression-satb';
    const dir = song ? path.join(ROOT, 'songs', song, 'score') : path.join(ROOT, 'score');
    fs.mkdirSync(dir, { recursive: true });
    args.push('-o', path.join(dir, base), '--title', song ? `${song} - ${base}` : base);
  }
  const r = await runPy(args);
  const line = r.out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  if (r.code !== 0 || !line) return { ok: false, message: lastLine(r.err) || lastLine(r.out) || 'Realizzazione non riuscita' };
  return { ok: true, ...JSON.parse(line) };
});

ipcMain.handle('harmony:voices', async (_e, v) => {
  const r = await runPy([path.join(ROOT, 'tools', 'voice_check.py'), '--s', v.s, '--a', v.a, '--t', v.t, '--b', v.b]);
  if (r.code !== 0 && r.code !== 1) return { ok: false, message: lastLine(r.err) || lastLine(r.out) || 'Controllo non riuscito' };
  return { ok: true, errors: r.code === 1, report: r.out.trim() };
});

function books() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'books.json'), 'utf8')); } catch { return {}; } }

ipcMain.handle('book:page', async (_e, book, page) => {
  const r = await runPy([path.join(ROOT, 'tools', 'page.py'), String(book), String(page)]);
  const png = r.out.trim().split(/\r?\n/).find((l) => /\.png\s*$/i.test(l));
  if (r.code !== 0 || !png) return { ok: false, message: lastLine(r.err) || lastLine(r.out) || 'Pagina non disponibile' };
  const p = path.isAbsolute(png.trim()) ? png.trim() : path.join(ROOT, png.trim());
  return { ok: true, dataUrl: 'data:image/png;base64,' + fs.readFileSync(p).toString('base64') };
});

// Lettore PDF integrato: una finestra dell'app con il visore PDF di Chromium, aperta sulla pagina richiesta.
let reader = null;
ipcMain.handle('book:reader', (_e, book, printedPage) => {
  const b = books()[book];
  if (!b || !b.pdf) return { ok: false, message: 'Libro sconosciuto' };
  if (!fs.existsSync(b.pdf)) return { ok: false, message: `PDF non trovato: ${b.pdf}. Correggi il percorso in tools/books.json.` };
  const pdfPage = Math.max(1, Number(printedPage || 1) + Number(b.offset || 0));
  const url = pathToFileURL(b.pdf).href + '#page=' + pdfPage;
  const title = `${b.titolo || book} – p. ${printedPage}`;
  if (!reader || reader.isDestroyed()) {
    reader = new BrowserWindow({ width: 980, height: 1000, backgroundColor: '#121315', title, autoHideMenuBar: true,
      webPreferences: { plugins: true, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    reader.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    reader.webContents.on('will-navigate', (ev, u) => { if (!u.startsWith('file:')) ev.preventDefault(); });
  }
  reader.setTitle(title);
  reader.loadURL(url);
  reader.on('page-title-updated', (ev) => ev.preventDefault());
  reader.show(); reader.focus();
  return { ok: true };
});

ipcMain.handle('book:open', (_e, book) => {
  const b = books()[book];
  if (!b || !b.pdf) return 'Libro sconosciuto';
  return shell.openPath(b.pdf);
});

ipcMain.handle('audio:analyze', (_e, filePath) => new Promise((resolve) => {
  const child = spawn(config().pythonCommand, [path.join(ROOT, 'tools', 'analyze.py'), filePath, '--json'], { cwd: ROOT, windowsHide: true });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', () => resolve({ ok: false, message: 'Python non trovato. Installa Python e le librerie: pip install numpy scipy soundfile pyloudnorm' }));
  child.on('close', (code) => {
    if (code !== 0) return resolve({ ok: false, message: (err.trim().split('\n').pop() || 'Analisi non riuscita') });
    try { resolve({ ok: true, data: JSON.parse(out) }); } catch { resolve({ ok: false, message: 'Risposta dello strumento di analisi non leggibile' }); }
  });
}));

ipcMain.handle('agent:ask', (e, req) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  const handle = claude.ask(req, { cwd: ROOT, command: config().claudeCommand }, (ev) => {
    if (ev.type === 'done') {
      usage.record(DATA_DIR, { agent: req.agent, song: req.song || '', phase: req.phase || '', request: String(req.label || req.prompt).slice(0, 90),
        input: ev.usage.input, output: ev.usage.output, cacheRead: ev.usage.cacheRead, durationMs: ev.durationMs || (Date.now() - started),
        turns: ev.turns, costUsd: ev.costUsd, ok: ev.ok });
    }
    if (ev.type === 'limits') {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, 'limits.json'), JSON.stringify({ ...ev, at: new Date().toISOString() })); } catch {}
    }
    if (ev.type === 'done' || ev.type === 'error') running.delete(id);
    if (!e.sender.isDestroyed()) e.sender.send('agent:event', id, ev);
  });
  running.set(id, handle);
  return id;
});
ipcMain.handle('agent:cancel', (_e, id) => { const h = running.get(id); if (h) h.cancel(); });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    // Web MIDI per suonare la progressione con Komplete Kontrol o altri strumenti.
    // Chromium chiede il permesso come «midiSysex» anche con { sysex: false }; l'app manda solo note.
    const midiPerm = (perm) => perm === 'midi' || perm === 'midiSysex';
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(midiPerm(perm)));
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => midiPerm(perm));
    if (!ROOT) {
      await dialog.showMessageBox({ type: 'info', title: 'Studio Agent', message: 'Scegli la cartella studio-agent',
        detail: 'Studio Agent usa gli agenti, i brani e gli strumenti che stanno nella tua cartella studio-agent (quella con .claude\\agents). Potrai cambiarla in seguito dal menu dei brani.' });
      await chooseRoot(null);
    }
    createWindow();
    setupUpdates();
  });
}

// Aggiornamenti automatici dalle Releases di GitHub (solo nell'app installata)
function setupUpdates() {
  if (!app.isPackaged) return;
  let updater;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = true;
  updater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Riavvia ora', 'Più tardi'], defaultId: 0,
      title: 'Aggiornamento pronto', message: `Studio Agent ${info.version} è pronto.`, detail: 'Riavvia per installarlo, oppure verrà installato alla prossima chiusura.' });
    if (r.response === 0) updater.quitAndInstall(true, true);   // installazione silenziosa e riapertura dell'app
  });
  updater.on('error', () => {});
  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}
app.on('window-all-closed', () => { for (const h of running.values()) h.cancel(); app.quit(); });
