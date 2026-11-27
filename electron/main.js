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
  const def = { claudeCommand: 'claude', pythonCommand: PYTHON.path || (process.platform === 'win32' ? 'python' : 'python3') };
  return { ...def, ...readJson(path.join(APP_DIR, 'config.json'), {}), ...(settings().commands || {}) };
}

// ---------- Python con le librerie degli strumenti ----------
// Su Windows «python» può essere un'installazione senza librerie (es. Python Install Manager 3.14):
// l'app cerca un Python che abbia mido, numpy, music21, soundfile, pyloudnorm e pymupdf e lo usa
// sia per gli strumenti sia per gli agenti (mettendo la sua cartella in testa al PATH).
const PY_LIBS = ['mido', 'numpy', 'scipy', 'music21', 'soundfile', 'pyloudnorm', 'fitz'];
let PYTHON = { path: '', version: '', missing: [], checked: false };
function pythonCandidates() {
  const c = [];
  const fixed = (settings().commands || {}).pythonCommand;
  if (fixed) c.push(fixed);
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || '';
    const dirs = [path.join(la, 'Programs', 'Python'), path.join(la, 'Python'), 'C:\\Program Files', 'C:\\'];
    for (const d of dirs) {
      try {
        for (const n of fs.readdirSync(d).filter((x) => /^(python|pythoncore-)\d/i.test(x)).sort().reverse()) {
          const exe = path.join(d, n, 'python.exe');
          if (fs.existsSync(exe)) c.push(exe);
        }
      } catch { /* cartella assente */ }
    }
    c.push('python', 'py');
  } else c.push('python3', 'python');
  return [...new Set(c)];
}
function probePython(cmd) {
  return new Promise((resolve) => {
    const code = `import sys,importlib.util as u;print(sys.executable);print(sys.version.split()[0]);print(','.join(m for m in ${JSON.stringify(PY_LIBS)} if u.find_spec(m) is None))`;
    let out = '';
    let child;
    try { child = spawn(cmd, ['-c', code], { windowsHide: true }); } catch { return resolve(null); }
    const t = setTimeout(() => { try { child.kill(); } catch { /* già chiuso */ } resolve(null); }, 8000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(t); resolve(null); });
    child.on('close', (code0) => {
      clearTimeout(t);
      const [exe, version, missing] = out.trim().split(/\r?\n/);
      resolve(code0 === 0 && exe ? { path: exe.trim(), version: (version || '').trim(), missing: (missing || '').trim() ? missing.trim().split(',') : [] } : null);
    });
  });
}
async function detectPython() {
  let best = null;
  for (const cmd of pythonCandidates()) {
    const r = await probePython(cmd);
    if (!r) continue;
    if (!best || r.missing.length < best.missing.length) best = r;
    if (!r.missing.length) break;
  }
  PYTHON = best ? { ...best, checked: true } : { path: '', version: '', missing: PY_LIBS, checked: true };
  return PYTHON;
}
/** Ambiente per i processi figli: il Python scelto viene prima nel PATH, così anche gli agenti lo usano. */
function childEnv() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  if (PYTHON.path && path.isAbsolute(PYTHON.path)) {
    const dir = path.dirname(PYTHON.path);
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    env[key] = [dir, path.join(dir, 'Scripts'), env[key] || ''].join(path.delimiter);
  }
  return env;
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
// ---------- programmi per l'ascolto via MIDI (solo Windows): loopMIDI e Komplete Kontrol ----------
const MIDI_APPS = {
  loopmidi: { exe: 'loopMIDI.exe', paths: ['C:\\Program Files (x86)\\Tobias Erichsen\\loopMIDI\\loopMIDI.exe', 'C:\\Program Files\\Tobias Erichsen\\loopMIDI\\loopMIDI.exe'] },
  kk: { exe: 'Komplete Kontrol.exe', paths: [
    'C:\\Program Files\\Native Instruments\\Komplete Kontrol\\Komplete Kontrol.exe',
    'D:\\Native Instruments\\Komplete Kontrol\\Komplete Kontrol.exe',
    'E:\\Native Instrument\\Application\\Komplete Kontrol\\Komplete Kontrol.exe',
    'E:\\Native Instruments\\Komplete Kontrol\\Komplete Kontrol.exe'] },
};
function runningExes() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    let out = '';
    const c = spawn('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true });
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => resolve([]));
    c.on('close', () => resolve(out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((x) => x.toLowerCase())));
  });
}
function regInstallDir(key) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('');
    let out = '';
    const c = spawn('reg', ['query', key, '/v', 'InstallDir'], { windowsHide: true });
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', () => resolve(''));
    c.on('close', () => resolve(((out.match(/InstallDir\s+REG_SZ\s+(.+)/) || [])[1] || '').trim()));
  });
}
async function findMidiApp(which) {
  const a = MIDI_APPS[which];
  const fixed = (settings().apps || {})[which];
  const cands = [fixed, ...a.paths];
  if (which === 'kk') {
    const dir = await regInstallDir('HKLM\\SOFTWARE\\Native Instruments\\Komplete Kontrol');
    if (dir) cands.unshift(path.join(dir, a.exe));
  }
  return cands.find((p) => p && fs.existsSync(p)) || '';
}
ipcMain.handle('midi:apps', async () => {
  const run = await runningExes();
  return {
    windows: process.platform === 'win32',
    loopmidi: { running: run.includes('loopmidi.exe'), path: await findMidiApp('loopmidi') },
    kk: { running: run.includes('komplete kontrol.exe'), path: await findMidiApp('kk') },
  };
});
ipcMain.handle('midi:launch', async (_e, which) => {
  if (!MIDI_APPS[which]) return { ok: false };
  const p = await findMidiApp(which);
  if (!p) return { ok: false, message: `${MIDI_APPS[which].exe} non trovato` };
  const err = await shell.openPath(p);
  return err ? { ok: false, message: err } : { ok: true };
});

// ---------- Partitura: file e soundfont per il lettore integrato ----------
const SF_BUNDLED = app.isPackaged
  ? path.join(process.resourcesPath, 'soundfonts', 'MuseScore_General_Lite.sf3')
  : path.join(APP_DIR, 'node_modules', '@librescore', 'sf3', 'MuseScore_General_Lite.sf3.wasm');
ipcMain.handle('file:read', (_e, p) => {
  if (!inside(p) || !/\.(musicxml|xml|mid|midi)$/i.test(p)) return null;
  try { return new Uint8Array(fs.readFileSync(p)); } catch { return null; }
});
ipcMain.handle('soundfont:get', () => {
  const custom = settings().soundfont;
  for (const [p, own] of [[custom, true], [SF_BUNDLED, false]]) {
    if (p && fs.existsSync(p)) {
      try { return { name: own ? path.basename(p) : 'MuseScore General (GM)', custom: own, data: new Uint8Array(fs.readFileSync(p)) }; } catch { /* prova il successivo */ }
    }
  }
  return null;
});
ipcMain.handle('soundfont:pick', async (_e, reset) => {
  const s = settings();
  if (reset) { delete s.soundfont; saveSettings(s); return true; }
  const r = await dialog.showOpenDialog(win, { title: 'Scegli un soundfont', properties: ['openFile'], filters: [{ name: 'SoundFont', extensions: ['sf2', 'sf3', 'dls'] }] });
  if (r.canceled || !r.filePaths[0]) return false;
  s.soundfont = r.filePaths[0]; saveSettings(s); return true;
});
ipcMain.handle('python:info', async (_e, again) => { if (again) pyDetect = null; return ensurePython(); });
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

let pyDetect = null;
function ensurePython() { return pyDetect || (pyDetect = detectPython()); }

async function runPy(args) {
  await ensurePython();
  return new Promise((resolve) => {
    const child = spawn(config().pythonCommand, args, { cwd: ROOT, windowsHide: true, env: childEnv() });
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
ipcMain.handle('songs:form', (_e, song, form) => songs.setBriefField(ROOT, song, 'Forma', form, 'Struttura e armonia'));

// Arrangiamento del brano (tools/arrange.py): eventi per l'ascolto e, se richiesto, il MIDI unico in midi/
ipcMain.handle('harmony:arrange', async (_e, { song, style, melody, instrument, form, write }) => {
  if (!song) return { ok: false, message: 'Apri un brano: l\'arrangiamento legge forma e sezioni da SONG.md' };
  const args = [path.join(ROOT, 'tools', 'arrange.py'), '--song', path.join(ROOT, 'songs', song), '--style', style || 'pop', '--json'];
  if (melody) args.push('--melody', '--melody-instrument', instrument || 'Flute');
  if (form) args.push('--form', form);
  if (write) {
    const st = String(style || 'pop');
    args.push('-o', path.join(ROOT, 'songs', song, 'midi', `${song} - ${st[0].toUpperCase() + st.slice(1)} Arrangement.mid`));
  }
  const r = await runPy(args);
  const line = r.out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  if (!line) return { ok: false, message: lastLine(r.err) || 'Arrangiamento non riuscito' };
  return JSON.parse(line);
});

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

// Analisi di un MIDI esistente (tools/midi2chords.py): progressione e tonalità stimata
ipcMain.handle('harmony:analyzeMidi', async (_e, song) => {
  const r0 = await dialog.showOpenDialog(win, {
    title: 'Scegli un file MIDI da analizzare', defaultPath: song ? path.join(ROOT, 'songs', song, 'midi') : ROOT,
    properties: ['openFile'], filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }],
  });
  if (r0.canceled || !r0.filePaths[0]) return { ok: false, canceled: true };
  const r = await runPy([path.join(ROOT, 'tools', 'midi2chords.py'), r0.filePaths[0], '--json']);
  const line = r.out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  if (!line) return { ok: false, message: lastLine(r.err) || 'Analisi non riuscita' };
  return { ...JSON.parse(line), file: r0.filePaths[0] };
});

// Realizzazione a quattro voci (tools/satb.py): voci in JSON e, se richiesto, MusicXML + MIDI in score/
ipcMain.handle('harmony:satb', async (_e, { song, progression, bpm, key, name, write, exercise }) => {
  const args = [path.join(ROOT, 'tools', 'satb.py'), progression, '--json'];
  if (exercise) args.push('--exercise');
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
  const args = [path.join(ROOT, 'tools', 'voice_check.py'), '--s', v.s, '--a', v.a, '--t', v.t, '--b', v.b];
  if (v.chords) args.push('--chords', v.chords);           // controllo di raddoppi, sensibile e settima
  if (v.key) args.push('--key', v.key);
  const r = await runPy(args);
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

ipcMain.handle('audio:analyze', async (_e, filePath) => { await ensurePython(); return new Promise((resolve) => {
  const child = spawn(config().pythonCommand, [path.join(ROOT, 'tools', 'analyze.py'), filePath, '--json'], { cwd: ROOT, windowsHide: true, env: childEnv() });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', () => resolve({ ok: false, message: 'Python non trovato. Installa Python e le librerie: pip install numpy scipy soundfile pyloudnorm' }));
  child.on('close', (code) => {
    if (code !== 0) return resolve({ ok: false, message: (err.trim().split('\n').pop() || 'Analisi non riuscita') });
    try { resolve({ ok: true, data: JSON.parse(out) }); } catch { resolve({ ok: false, message: 'Risposta dello strumento di analisi non leggibile' }); }
  });
}); });

// Confronto tra due file audio (tools/compare.py): due versioni del mix o il mix e un riferimento
function resolveAudio(song, p) {
  if (!p) return '';
  if (path.isAbsolute(p) && fs.existsSync(p)) return p;
  const base = song ? path.join(ROOT, 'songs', song) : ROOT;
  for (const d of ['', 'audio', 'stems', 'reports', 'mix']) {
    const c = path.join(base, d, p);
    if (fs.existsSync(c)) return c;
  }
  return '';
}
ipcMain.handle('audio:compare', async (_e, { song, a, b, ref }) => {
  const pa = resolveAudio(song, a), pb = resolveAudio(song, b);
  if (!pa || !pb) return { ok: false, message: `File non trovato: ${!pa ? a : b} (cerco nella cartella del brano e in audio/)` };
  const args = [path.join(ROOT, 'tools', 'compare.py'), pa, pb, '--json'];
  if (ref) args.push('--ref');
  const r = await runPy(args);
  const line = r.out.trim().split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  if (!line) return { ok: false, message: lastLine(r.err) || 'Confronto non riuscito' };
  return JSON.parse(line);
});

ipcMain.handle('agent:ask', async (e, req) => {
  await ensurePython();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  const handle = claude.ask(req, { cwd: ROOT, command: config().claudeCommand, env: childEnv() }, (ev) => {
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
    ensurePython();                                   // cerca subito il Python con le librerie
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
