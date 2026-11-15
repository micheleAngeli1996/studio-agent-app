// Lettura e scrittura della memoria dei brani (songs/<Song Title>/SONG.md)
const fs = require('fs');
const path = require('path');

function section(md, title) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).trim().toLowerCase().startsWith(title.toLowerCase()));
  if (start < 0) return { start: -1, end: -1, body: [] };
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return { start, end, body: lines.slice(start + 1, end) };
}

function table(body) {
  const rows = body.filter((l) => l.trim().startsWith('|')).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  return rows.filter((r, i) => i > 0 && !r.every((c) => /^:?-+:?$/.test(c)) && r.some((c) => c));
}

function field(body, label) {
  const l = body.find((x) => x.trim().toLowerCase().startsWith('- ' + label.toLowerCase()));
  if (!l) return '';
  return l.slice(l.indexOf(':') + 1).replace(/<!--.*?-->/g, '').trim();
}

function parseSong(root, name) {
  const dir = path.join(root, 'songs', name);
  const file = path.join(dir, 'SONG.md');
  const md = fs.readFileSync(file, 'utf8');
  const brief = section(md, 'Brief').body;
  const files = [];
  for (const sub of ['audio', 'midi', 'score', 'stems', 'notes', 'reports']) {
    const d = path.join(dir, sub);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile()) files.push({ name: f, kind: sub, path: p });
    }
  }
  return {
    name,
    title: (md.match(/^# (.+)$/m) || [, name])[1].trim(),
    path: file,
    relPath: `songs/${name}/SONG.md`,
    key: field(brief, 'Tonalità'),
    tempo: field(brief, 'Tempo'),
    phase: field(brief, 'Fase attuale').toLowerCase(),
    goal: field(brief, 'Obiettivo'),
    compositionType: field(brief, 'Tipo di composizione'),
    progression: progressionOf(md),
    sections: sectionsOf(md),
    tracks: table(section(md, 'Tracce').body).map((r) => ({ name: r[0], role: r[1] || '', instrument: r[2] || '' })).filter((t) => t.name),
    decisions: section(md, 'Decisioni').body.filter((l) => l.trim().startsWith('- ')).map((l) => {
      const parts = l.trim().slice(2).split(' · ');
      return parts.length >= 3 ? { date: parts[0], agent: parts[1], text: parts.slice(2).join(' · ') } : { date: '', agent: '', text: l.trim().slice(2) };
    }),
    versions: table(section(md, 'Versioni del mix').body).map((r) => ({ date: r[0], file: (r[1] || '').replace(/`/g, ''), lufs: r[2] || '', truePeak: r[3] || '', note: r[4] || '' })),
    files,
  };
}

function listSongs(root) {
  const d = path.join(root, 'songs');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((n) => !n.startsWith('_') && fs.existsSync(path.join(d, n, 'SONG.md')))
    .map((n) => { try { return parseSong(root, n); } catch (e) { return null; } })
    .filter(Boolean);
}

function insertInSection(file, title, line) {
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split(/\r?\n/);
  const s = section(md, title);
  if (s.start < 0) throw new Error(`Sezione "${title}" non trovata in ${file}`);
  let at = s.end;
  while (at > s.start + 1 && lines[at - 1].trim() === '') at--;
  lines.splice(at, 0, line);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDecision(root, name, agent, text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Decisione vuota');
  insertInSection(path.join(root, 'songs', name, 'SONG.md'), 'Decisioni', `- ${today()} · ${agent} · ${clean}`);
  return parseSong(root, name);
}

function addVersion(root, name, v) {
  const cell = (x) => String(x ?? '').replace(/\|/g, '/').trim();
  insertInSection(path.join(root, 'songs', name, 'SONG.md'), 'Versioni del mix',
    `| ${today()} | \`${cell(v.file)}\` | ${cell(v.lufs)} | ${cell(v.truePeak)} | ${cell(v.note)} |`);
  return parseSong(root, name);
}

function createSong(root, { title, bpm = '', key = '', meter = '4/4' }) {
  const name = String(title || '').replace(/[<>:"/\\|?*]/g, '').trim();
  if (!name) throw new Error('Titolo non valido');
  const dir = path.join(root, 'songs', name);
  if (fs.existsSync(path.join(dir, 'SONG.md'))) throw new Error('Esiste già un brano con questo titolo');
  for (const sub of ['midi', 'score', 'audio', 'stems', 'notes', 'reports']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const tpl = fs.readFileSync(path.join(root, 'songs', '_template', 'SONG.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'SONG.md'),
    tpl.replace('{{TITLE}}', title).replace('{{KEY}}', key).replace('{{BPM}}', String(bpm)).replace('{{METER}}', meter), 'utf8');
  return parseSong(root, name);
}

function progressionOf(md) {
  const body = section(md, 'Struttura e armonia').body;
  const named = (l) => /^- Progressione\s*\(/i.test(l.trim());
  const tagged = body.find((l) => /^- Progressione:\s*`/i.test(l.trim()));
  const any = tagged || body.find((l) => !named(l) && /`[^`]+`/.test(l));
  return any ? any.match(/`([^`]+)`/)[1].trim() : '';
}

/** Progressioni per sezione: righe «- Progressione (Verse): `...`»; quella senza nome è la principale. */
function sectionsOf(md) {
  const out = [];
  for (const l of section(md, 'Struttura e armonia').body) {
    const m = l.trim().match(/^- Progressione(?:\s*\(([^)]+)\))?:\s*`([^`]+)`/i);
    if (m) out.push({ section: (m[1] || '').trim(), progression: m[2].trim() });
  }
  return out;
}

function setProgression(root, name, prog, sectionName = '') {
  const file = path.join(root, 'songs', name, 'SONG.md');
  const clean = String(prog).replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Progressione vuota');
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split(/\r?\n/);
  const s = section(md, 'Struttura e armonia');
  if (s.start < 0) throw new Error('Sezione "Struttura e armonia" non trovata');
  const sec = String(sectionName || '').replace(/[()`\r\n]/g, '').trim();
  const label = sec ? `- Progressione (${sec}):` : '- Progressione:';
  const line = `${label} \`${clean}\``;
  const i = lines.findIndex((l, k) => k > s.start && k < s.end && l.trim().toLowerCase().startsWith(label.toLowerCase() + ' `'));
  if (i >= 0) lines[i] = line;
  else {
    let last = -1;
    for (let k = s.start + 1; k < s.end; k++) if (/^- Progressione/i.test(lines[k].trim())) last = k;
    lines.splice(last >= 0 ? last + 1 : s.start + 1, 0, line);
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return parseSong(root, name);
}

/** Imposta un campo del brief (es. "Tipo di composizione"), aggiungendolo dopo l'ultima riga del brief se manca. */
function setBriefField(root, name, label, value) {
  const file = path.join(root, 'songs', name, 'SONG.md');
  const clean = String(value).replace(/[\r\n`]/g, ' ').trim();
  const md = fs.readFileSync(file, 'utf8');
  const lines = md.split(/\r?\n/);
  const s = section(md, 'Brief');
  if (s.start < 0) throw new Error('Sezione "Brief" non trovata');
  const line = `- ${label}: ${clean}`;
  const i = lines.findIndex((l, k) => k > s.start && k < s.end && l.trim().toLowerCase().startsWith('- ' + label.toLowerCase()));
  if (i >= 0) lines[i] = line;
  else {
    let last = s.start;
    for (let k = s.start + 1; k < s.end; k++) if (lines[k].trim().startsWith('- ')) last = k;
    lines.splice(last + 1, 0, line);
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return parseSong(root, name);
}

module.exports = { listSongs, parseSong, addDecision, addVersion, createSong, setProgression, setBriefField };
