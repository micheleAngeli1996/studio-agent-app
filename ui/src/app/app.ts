import { Component, computed, effect, signal, untracked, ChangeDetectionStrategy, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { api, isDemo, AgentEvent, Song, UsageEntry, Limits, Comparison } from './api';
import { mdToHtml, firstSentence, linkCitations, linkChordLines } from './md';
import { analyze as analyzeProg, keyForMidi, BOOKS, chordTones, parseProgression, isChordLine, ChordTones } from './harmony';
import { Piano, Style, ChannelMode } from './piano';
import { suggest, exerciseModels, EXERCISE_LEVELS, COMPOSITION_TYPES, TECHNIQUES, typeFromText, homeLabel, CompositionType, Technique, Suggestion } from './suggestions';

const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ITA: Record<string, string> = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
/** «C4», «F#3», «Bb2», «Do4», «Sib2» → numero MIDI (C4 = 60). */
export function noteMidi(tok: string): number | null {
  let t = tok.trim();
  const it = t.match(/^(do|re|mi|fa|sol|la|si)([#b]*)(-?\d)$/i);
  if (it) t = ITA[it[1].toLowerCase()] + it[2] + it[3];
  const m = t.match(/^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d)$/);
  if (!m) return null;
  const acc = !m[2] ? 0 : m[2][0] === '#' ? m[2].length : -m[2].length;
  return NOTE_PC[m[1].toUpperCase()] + acc + 12 * (+m[3] + 1);
}
const render = (text: string) => linkChordLines(linkCitations(mdToHtml(text)), isChordLine);

interface Phase { id: string; label: string; agent: string; hint: string; }
interface Msg { role: 'user' | 'agent'; agent: string; text: string; html: string; tools: string[]; status: 'running' | 'done' | 'error'; usage?: { input: number; output: number }; durationMs?: number; saved?: boolean; }
interface Conv { sessionId?: string; msgs: Msg[]; }

const PHASES: Phase[] = [
  { id: 'armonia', label: 'Armonia', agent: 'armonia', hint: 'Chiedi una progressione, una modulazione, un controllo a quattro voci' },
  { id: 'orchestrazione', label: 'Orchestrazione', agent: 'orchestrazione', hint: 'Chiedi a chi affidare la melodia, registri, articolazioni' },
  { id: 'tracking', label: 'Tracking', agent: 'tracking', hint: 'Chiedi come registrare: livelli, microfoni, monitoraggio sulla UR816' },
  { id: 'mix', label: 'Mix', agent: 'mixer', hint: 'Scrivi al mixer, oppure trascina qui un file audio' },
  { id: 'master', label: 'Master', agent: 'mastering', hint: 'Chiedi se il mix è pronto, target di loudness, esportazione' },
];
const EXTRA: Phase[] = [
  { id: 'dorico', label: 'Dorico', agent: 'dorico', hint: 'Chiedi come fare qualcosa in Dorico 6' },
  { id: 'cubase', label: 'Guida Cubase', agent: 'bibliotecario', hint: 'Chiedi il nome esatto di una funzione o una procedura di Cubase 15' },
  { id: 'team', label: 'Produttore: tutto il team', agent: 'produttore', hint: 'Una richiesta ampia: il produttore coinvolge gli specialisti necessari' },
];
const BAND_LABELS: Record<string, string> = {
  'sub 20-60 Hz': '20–60 Hz', 'bassi 60-250 Hz': '60–250 Hz', 'medio-bassi 250-500 Hz': '250–500 Hz', 'medi 500 Hz-2 kHz': '0,5–2 kHz',
  'medio-alti 2-6 kHz': '2–6 kHz', 'alti 6-12 kHz': '6–12 kHz', 'aria 12-20 kHz': '12–20 kHz',
};
const LS = 'studio-agent.ui';

@Component({
  selector: 'app-root',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'songMenu.set(false)', '(document:click)': 'onDocClick($event)' },
})
export class App {
  readonly phases = PHASES;
  readonly extra = EXTRA;
  readonly isDemo = isDemo;

  view = signal<'console' | 'usage'>('console');
  songs = signal<Song[]>([]);
  songName = signal<string>('');
  song = computed(() => this.songs().find((s) => s.name === this.songName()) ?? null);
  phaseId = signal<string>('mix');
  phase = computed(() => [...PHASES, ...EXTRA].find((p) => p.id === this.phaseId())!);
  leftOpen = signal(true);
  rightOpen = signal(true);
  songMenu = signal(false);
  newSong = signal<{ title: string; bpm: string; key: string } | null>(null);
  root = signal('');
  version = signal('');
  needsRoot = signal(false);
  notice = signal<string>('');

  convs = signal<Record<string, Conv>>({});
  conv = computed(() => this.convs()[this.convKey()] ?? { msgs: [] });
  draft = signal('');
  busyId = signal<string | null>(null);
  activity = signal<string>('');

  measureFile = signal<string>('');
  measure = signal<Record<string, any> | null>(null);
  measuring = signal(false);
  measureError = signal('');
  dragOver = signal(false);

  usage = signal<UsageEntry[]>([]);
  limits = signal<Limits | null>(null);
  limitView = computed(() => {
    const l = this.limits();
    if (!l) return null;
    const one = (w: any, label: string) => w ? { label, pct: Math.round(w.utilization * 100), reset: this.resetText(w.resetsAt), warn: w.utilization >= 0.8 } : null;
    return [one(l.fiveHour, 'Finestra di 5 ore'), one(l.sevenDay, 'Limite settimanale')].filter((x): x is NonNullable<typeof x> => !!x);
  });
  period = signal<'day' | 'week' | 'month' | 'all'>('week');
  filter = signal('');

  private thread = viewChild<ElementRef<HTMLElement>>('thread');

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || '{}');
      if (s.leftOpen === false) this.leftOpen.set(false);
      if (s.rightOpen === false) this.rightOpen.set(false);
      if (s.phaseId) this.phaseId.set(s.phaseId);
      if (s.convs) this.convs.set(Object.fromEntries(Object.entries(s.convs as Record<string, Conv>).map(([k, c]) =>
        [k, { sessionId: c.sessionId, msgs: c.msgs.filter((m) => m.status !== 'running').slice(-40) }])));
      this.pendingSong = s.songName || '';
    } catch { /* stato locale non disponibile */ }
    effect(() => {
      const state = { leftOpen: this.leftOpen(), rightOpen: this.rightOpen(), phaseId: this.phaseId(), songName: this.songName(), convs: this.convs() };
      try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* ignora */ }
    });
    effect(() => { this.conv(); queueMicrotask(() => { const el = this.thread()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }); });
    api.onAgentEvent((id, ev) => this.onEvent(id, ev));
    this.loadMidi();
    this.load();
  }
  private pendingSong = '';
  private lastReq: any = null;
  private retried = false;
  private runningKey = '';

  async load() {
    const [info, songs, usage, limits] = await Promise.all([api.info(), api.listSongs(), api.usage(), api.limits()]);
    this.limits.set(limits);
    this.root.set(info.root);
    this.version.set(info.version || '');
    this.needsRoot.set(!info.hasAgents);
    if (!info.hasAgents) this.notice.set(info.root ? `Non trovo gli agenti in ${info.root}\\.claude\\agents.` : 'Scegli la cartella studio-agent per usare agenti, brani e strumenti.');
    this.songs.set(songs);
    this.usage.set(usage);
    const pick = songs.find((s) => s.name === this.pendingSong) ?? songs[0];
    if (pick) this.selectSong(pick.name, false);
    this.checkPython();
  }

  /** Chiude il menu dei brani con un clic fuori dal menu. */
  onDocClick(e: MouseEvent) {
    if (this.songMenu() && !(e.target as HTMLElement).closest?.('.songpick')) this.songMenu.set(false);
  }

  // Python usato dagli strumenti (l'app sceglie quello che ha le librerie)
  python = signal<{ path: string; version: string; missing: string[] } | null>(null);
  pyDismissed = signal(false);
  pipCommand = computed(() => {
    const p = this.python(); if (!p?.missing.length) return '';
    const pkg: Record<string, string> = { fitz: 'pymupdf' };
    return `"${p.path || 'python'}" -m pip install ${p.missing.map((m) => pkg[m] || m).join(' ')}`;
  });
  async checkPython(again = false) {
    try { this.python.set(await api.pythonInfo(again)); } catch { /* anteprima */ }
  }

  async changeRoot() {
    const r = await api.chooseRoot();
    if (r.ok) { this.notice.set(''); this.songMenu.set(false); this.songName.set(''); this.measure.set(null); await this.load(); }
    else if (r.message) this.notice.set(r.message);
  }

  convKey() { return `${this.songName() || '-'}::${this.phase().agent}`; }

  selectSong(name: string, setPhase = true) {
    this.stopPlay();
    this.songName.set(name);
    this.songMenu.set(false);
    const s = this.song();
    if (setPhase && s) {
      const map: Record<string, string> = { idea: 'armonia', armonia: 'armonia', orchestrazione: 'orchestrazione', tracking: 'tracking', mix: 'mix', master: 'master' };
      const p = map[(s.phase.split(/\s/)[0] || '').trim()];
      if (p) this.phaseId.set(p);
    }
    const last = s?.versions.at(-1);
    if (s && !this.measure() && last) this.measureFile.set(last.file);
  }

  phaseState(p: Phase): 'done' | 'current' | 'todo' {
    const order = PHASES.map((x) => x.id);
    const cur = (this.song()?.phase || '').split(/\s/)[0];
    const ci = cur === 'idea' ? -1 : cur === 'finito' ? 99 : order.indexOf(cur);
    const i = order.indexOf(p.id);
    if (ci < 0 && cur !== 'idea') return 'todo';
    return i < ci ? 'done' : i === ci ? 'current' : 'todo';
  }

  // ---------- conversazione ----------
  async send(text?: string, label?: string) {
    const body = (text ?? this.draft()).trim();
    if (!body || this.busyId()) return;
    const s = this.song();
    const agent = this.phase().agent;
    const key = this.convKey();
    const prev = this.convs()[key] ?? { msgs: [] };
    const context = s
      ? `[Contesto dall'app Studio Agent. Brano: "${s.title}". La memoria del brano è in "${s.relPath}": leggila prima di rispondere e aggiornala come indicano le tue istruzioni. Tipo di composizione: ${this.typeLabel()}.${this.measure() ? ` File audio misurato nel pannello Misure: "${this.measureFile()}".` : ''}]\n\n`
      : `[Contesto dall'app Studio Agent: nessun brano aperto.]\n\n`;
    const user: Msg = { role: 'user', agent, text: body, html: mdToHtml(body), tools: [], status: 'done' };
    const pending: Msg = { role: 'agent', agent, text: '', html: '', tools: [], status: 'running' };
    this.setConv(key, { sessionId: prev.sessionId, msgs: [...prev.msgs, user, pending] });
    if (text === undefined) this.draft.set('');
    this.activity.set('Avvio di Claude Code…');
    this.runningKey = key;
    this.lastReq = { agent, prompt: context + body, resume: prev.sessionId, song: s?.name, phase: this.phaseId(), label: label ?? body };
    this.retried = false;
    const id = await api.ask(this.lastReq);
    this.busyId.set(id);
  }

  cancel() { const id = this.busyId(); if (id) api.cancel(id); }

  private setConv(key: string, c: Conv) { this.convs.update((all) => ({ ...all, [key]: c })); }

  private updateLast(fn: (m: Msg) => Msg, sessionId?: string) {
    const key = this.runningKey;
    const c = this.convs()[key];
    if (!c) return;
    const msgs = [...c.msgs];
    msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
    this.setConv(key, { sessionId: sessionId === '' ? undefined : (sessionId ?? c.sessionId), msgs });
  }

  private onEvent(id: string, ev: AgentEvent) {
    if (id !== this.busyId() && ev.type !== 'done' && ev.type !== 'error') { /* evento prima che l'id sia noto: accetta */ }
    switch (ev.type) {
      case 'start': this.updateLast((m) => m, ev.sessionId); this.activity.set('Sta leggendo la memoria del brano…'); break;
      case 'tool': this.activity.set(ev.summary); this.updateLast((m) => ({ ...m, tools: [...m.tools, ev.summary] })); break;
      case 'delta': this.updateLast((m) => { const text = m.text + ev.text; return { ...m, text, html: render(text) }; }); break;
      case 'blockstart': this.updateLast((m) => (m.text && !m.text.endsWith('\n\n') ? { ...m, text: m.text + '\n\n' } : m)); break;
      case 'limits': this.limits.set({ fiveHour: ev.fiveHour, sevenDay: ev.sevenDay }); break;
      case 'text': this.updateLast((m) => { const text = m.text ? m.text + '\n\n' + ev.text : ev.text; return { ...m, text, html: render(text) }; }); break;
      case 'done':
        if (!ev.ok && this.lastReq?.resume && !this.retried) {
          // la conversazione precedente non si riesce a riprendere: riparte da capo, una volta sola
          this.retried = true;
          this.updateLast((m) => ({ ...m, text: '', html: '', tools: [] }), '');
          this.activity.set('Riprendo in una nuova conversazione…');
          api.ask({ ...this.lastReq, resume: undefined }).then((nid) => this.busyId.set(nid));
          break;
        }
        this.updateLast((m) => {
          const text = m.text || ev.result || ev.message || '(nessuna risposta)';
          return { ...m, text, html: render(text), status: ev.ok ? 'done' : 'error', usage: { input: ev.usage.input, output: ev.usage.output }, durationMs: ev.durationMs };
        }, ev.sessionId);
        this.finish(true);
        break;
      case 'error':
        this.updateLast((m) => ({ ...m, status: 'error', text: (m.text ? m.text + '\n\n' : '') + ev.message, html: mdToHtml((m.text ? m.text + '\n\n' : '') + ev.message) }));
        this.finish(false);
        break;
    }
  }

  private async finish(reload: boolean) {
    this.busyId.set(null);
    this.activity.set('');
    if (reload) {
      const [songs, usage] = await Promise.all([api.listSongs(), api.usage()]);
      this.songs.set(songs);
      this.usage.set(usage);
    }
  }

  newConversation() { this.setConv(this.convKey(), { msgs: [] }); }

  async saveDecision(m: Msg) {
    const s = this.song();
    if (!s) return;
    const updated = await api.addDecision(s.name, m.agent, firstSentence(m.text));
    this.replaceSong(updated);
    this.updateAt(m, (x) => ({ ...x, saved: true }));
  }

  private updateAt(target: Msg, fn: (m: Msg) => Msg) {
    const key = this.convKey(); const c = this.conv();
    this.setConv(key, { ...c, msgs: c.msgs.map((m) => (m === target ? fn(m) : m)) });
  }

  private replaceSong(s: Song) { this.songs.update((all) => all.map((x) => (x.name === s.name ? s : x))); }

  onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }

  // ---------- brani ----------
  async createSong() {
    const d = this.newSong();
    if (!d || !d.title.trim()) return;
    try {
      const s = await api.createSong({ title: d.title.trim(), bpm: d.bpm, key: d.key });
      this.songs.update((all) => [...all, s]);
      this.newSong.set(null);
      this.selectSong(s.name);
    } catch (e: any) { this.notice.set(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  }
  patchNewSong(k: 'title' | 'bpm' | 'key', v: string) { this.newSong.update((d) => (d ? { ...d, [k]: v } : d)); }

  // ---------- misure ----------
  async analyze(path: string) {
    if (!path) return;
    this.measureFile.set(path);
    this.comparison.set(null);
    this.measuring.set(true);
    this.measureError.set('');
    this.rightOpen.set(true);
    const r = await api.analyze(path);
    this.measuring.set(false);
    if (r.ok && r.data) this.measure.set(r.data); else { this.measure.set(null); this.measureError.set(r.message || 'Analisi non riuscita'); }
  }
  async pick() { const p = await api.pickAudio(); if (p) this.analyze(p); }

  // ---------- confronto A/B (tools/compare.py) ----------
  comparison = signal<Comparison | null>(null);
  comparing = signal(false);
  /** Versioni del mix registrate, escluso il file misurato ora (che fa da A). */
  otherVersions = computed(() => (this.song()?.versions ?? []).filter((v) => v.file && this.fileName(v.file) !== this.fileName(this.measureFile())));
  async compareWith(b: string, ref = false) {
    const a = this.measureFile();
    if (!a || !b) return;
    this.comparing.set(true);
    this.comparison.set(null);
    const r = await api.compareAudio({ song: this.song()?.name, a, b, ref });
    this.comparing.set(false);
    this.comparison.set(r);
  }
  async compareReference() { const p = await api.pickAudio(); if (p) this.compareWith(p, true); }
  /** Spettri in terzi d'ottava come polilinee SVG (asse x logaritmico 20 Hz-20 kHz). */
  spectrumPath(pts: [number, number][] | undefined, w = 300, h = 120) {
    if (!pts?.length) return '';
    const c = this.comparison();
    const all = [...(c?.spectrumA ?? []), ...(c?.spectrumB ?? [])].map((p) => p[1]);
    const lo = Math.min(...all), hi = Math.max(...all);
    const x = (f: number) => (Math.log10(f / 20) / Math.log10(1000)) * w;
    const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * (h - 8) - 4;
    return pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ');
  }
  onDrop(e: DragEvent) {
    e.preventDefault(); this.dragOver.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/\.(wav|flac|aiff?)$/i.test(f.name)) { this.measureError.set('Trascina un file WAV, FLAC o AIFF.'); return; }
    this.analyze(api.pathForFile(f));
  }
  onDragOver(e: DragEvent) { e.preventDefault(); this.dragOver.set(true); }
  fileName(p: string) { return p.split(/[\\/]/).pop() || p; }

  m = computed(() => {
    const d = this.measure();
    if (!d) return null;
    const lufs = d['loudness_integrato_LUFS']; const tp = d['true_peak_dBTP_stima']; const corr = d['correlazione_stereo'];
    const bandsRaw: Record<string, number> = d['energia_per_banda_dB_rispetto_al_totale'] || {};
    const bands = Object.entries(bandsRaw).map(([k, v]) => ({ label: BAND_LABELS[k] ?? k, value: v, pct: Math.max(2, Math.min(100, 100 + v * (100 / 36))) }));
    const top = bands.reduce((a, b) => (b.value > a.value ? b : a), bands[0]);
    return {
      lufs, tp, crest: d['crest_factor_dB'], corr, dur: d['durata_s'],
      tpWarn: tp > -1, corrWarn: corr !== undefined && corr < 0.2,
      bands: bands.map((b) => ({ ...b, hot: b === top && b.value > -3 })),
      hot: top && top.value > -3 ? top.label : '',
    };
  });
  fmt(v: any, d = 1) { return typeof v === 'number' ? v.toFixed(d).replace('-', '−').replace('.', ',') : '—'; }

  async recordVersion() {
    const s = this.song(); const m = this.m();
    if (!s || !m) return;
    const file = this.measureFile().replace(/\\/g, '/');
    const rel = this.root() && file.startsWith(this.root().replace(/\\/g, '/')) ? file.slice(this.root().length + 1) : file;
    const updated = await api.addVersion(s.name, { file: rel, lufs: this.fmt(m.lufs), truePeak: this.fmt(m.tp, 2) + ' dBTP', note: m.tpWarn ? 'poco headroom' : '' });
    this.replaceSong(updated);
  }

  askMixer() {
    if (this.phaseId() !== 'mix' && this.phaseId() !== 'master') this.phaseId.set('mix');
    const f = this.measureFile();
    this.send(`Analizza "${f}" con tools/analyze.py: è pronto per il passo successivo? Indica al massimo tre interventi in ordine di priorità.`, `Analisi di ${this.fileName(f)}`);
  }


  askCompare() {
    const c = this.comparison(); if (!c?.ok) return;
    if (this.phaseId() !== 'mix' && this.phaseId() !== 'master') this.phaseId.set('mix');
    const rows = [...(c.rows ?? []).map((r) => `${r.label}: A ${r.a} / B ${r.b} (${r.d > 0 ? '+' : ''}${r.d} ${r.unit})`),
      ...(c.bands ?? []).map((b) => `${b.name}: ${b.d > 0 ? '+' : ''}${b.d} dB`)].join('; ');
    this.send(`Confronto A/B: A = "${c.a}", B = "${c.b}"${c.ref ? ' (brano di riferimento)' : ' (versione precedente)'}. Misure (tools/compare.py): ${rows}. `
      + `Cosa cambieresti in A, in ordine di priorità (al massimo tre interventi, con plugin e parametri di Cubase 15)?${c.ref ? ' Ricorda che con un riferimento conta la forma dello spettro, non il volume.' : ''}`, `Confronto ${c.a} / ${c.b}`);
  }
  log10(x: number) { return Math.log10(x); }
  abs(x: number) { return Math.abs(x); }

  // ---------- armonia ----------
  readonly books = BOOKS;
  harmOpen = signal(true);
  prog = signal('');
  progKey = signal('');
  progBpm = signal('');
  cells = computed(() => analyzeProg(this.prog(), this.progKey(), this.beatsPerBar()));
  beatsPerBar = computed(() => { const m = (this.song()?.tempo || '').match(/(\d+)\s*\/\s*4/); return m ? +m[1] : 4; });
  progDirty = computed(() => (this.sectionTabs().find((t) => t.section === this.section())?.progression || '') !== this.prog().trim());

  // ---------- sezioni (Verse, Chorus, Bridge…) ----------
  readonly sectionNames = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Outro'];
  section = signal('');
  private drafts: Record<string, string> = {};
  sectionTabs = computed(() => {
    const s = this.song();
    const tabs = [{ section: '', progression: s?.progression || '' }, ...(s?.sections ?? []).filter((x) => x.section)];
    const cur = this.section();
    if (cur && !tabs.some((t) => t.section === cur)) tabs.push({ section: cur, progression: '' });
    return tabs;
  });
  sectionLabel(sec: string) { return sec || 'Principale'; }
  selectSection(sec: string) {
    if (sec === this.section()) return;
    this.drafts[this.section()] = this.prog();
    this.stopPlay();
    this.section.set(sec);
    this.insertAfter.set(-1);
    this.prog.set(this.drafts[sec] ?? this.sectionTabs().find((t) => t.section === sec)?.progression ?? '');
    this.harmMsg.set(null);
  }
  addSection(name: string) {
    const n = (name || '').trim();
    if (!n) return;
    let sec = n, k = 2;
    while (this.sectionTabs().some((t) => t.section === sec)) sec = `${n} ${k++}`;
    this.selectSection(sec);
  }
  private fileBase(suffix = '') {
    const sec = this.section().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return 'progression' + (sec ? '-' + sec : '') + suffix;
  }

  // punto di inserimento per gli sviluppi: dopo l'accordo scelto nella griglia, altrimenti in coda
  insertAfter = signal(-1);
  insertLabel = computed(() => {
    const i = this.insertAfter(); const c = this.cells()[i];
    return i >= 0 && c ? `dopo «${c.name}» (accordo ${i + 1}, b. ${c.bar})` : 'in coda alla progressione';
  });
  harmMsg = signal<{ ok: boolean; text: string; path?: string } | null>(null);
  voicesOpen = signal(false);
  voices = signal({ s: '', a: '', t: '', b: '' });
  voiceReport = signal<{ ok: boolean; errors?: boolean; text: string } | null>(null);
  showSource = computed(() => ['armonia', 'orchestrazione'].includes(this.phaseId()));

  book = signal('armonia1');
  bookPageNo = signal(84);
  pageImg = signal('');
  pageLoading = signal(false);
  pageError = signal('');
  zoomed = signal(false);

  private lastSong = '';
  private syncHarmony = effect(() => {
    const s = this.song();
    if ((s?.name ?? '') === this.lastSong) return;      // solo al cambio di brano, non a ogni ricarica
    this.lastSong = s?.name ?? '';
    this.drafts = {};
    this.section.set('');
    this.insertAfter.set(-1);
    this.exercise.set(null);
    this.prog.set(s?.progression || '');
    this.progKey.set(keyForMidi(s?.key || '') || '');
    this.progBpm.set((s?.tempo.match(/(\d+)\s*BPM/i) || [])[1] || '');
    this.harmMsg.set(null);
    // forma salvata, altrimenti (consigliato) tutte le sezioni nell'ordine in cui sono scritte
    const saved = (s?.form || '').split(/[\s,]+/).filter(Boolean);
    const named = (s?.sections ?? []).map((x) => x.section).filter(Boolean);
    this.formList.set(saved.length ? saved : named.length ? named : s?.progression ? ['Main'] : []);
    this.arrMsg.set(null);
    this.arrStyle.set(({ song: 'pop', ballad: 'ballad', symphony: 'chorale', film: 'arpeggio', chorale: 'chorale', jazz: 'pop' } as Record<string, string>)[typeFromText(s?.compositionType || '')] || 'pop');
  });
  private lastPhase = '';
  private syncBook = effect(() => {                     // libro predefinito solo quando si cambia fase
    const ph = this.phaseId();
    if (ph === this.lastPhase) return;
    this.lastPhase = ph;
    if (ph === 'orchestrazione') this.book.set('adler');
    if (ph === 'armonia' && untracked(this.book) === 'adler') this.book.set('armonia1');
  });

  patchVoices(k: 's' | 'a' | 't' | 'b', v: string) { this.voices.update((x) => ({ ...x, [k]: v })); }

  async saveProgression() {
    const s = this.song(); if (!s || !this.prog().trim()) return;
    try {
      this.replaceSong(await api.setProgression(s.name, this.prog().trim(), this.section()));
      delete this.drafts[this.section()];
      this.harmMsg.set({ ok: true, text: `Progressione${this.section() ? ' «' + this.section() + '»' : ''} salvata nella memoria del brano.` });
    }
    catch (e: any) { this.harmMsg.set({ ok: false, text: this.errText(e) }); }
  }

  async exportMidi() {
    if (!this.prog().trim()) return;
    this.harmMsg.set({ ok: true, text: 'Creo il file MIDI…' });
    const s = this.song();
    const r = await api.exportMidi({ song: s?.name, progression: this.prog().trim(), bpm: this.progBpm(), key: this.progKey(), name: this.fileBase() });
    this.harmMsg.set(r.ok ? { ok: true, text: 'MIDI pronto: tracce Melody, Strings, Piano, Electric Bass, Drums.', path: r.path } : { ok: false, text: r.message || 'Esportazione non riuscita' });
    if (r.ok) this.songs.set(await api.listSongs());
  }

  // ---------- quattro voci: realizzazione automatica ed esercizi ----------
  satbBusy = signal(false);
  exercise = signal<{ title: string; chords: { chord: string; numeral: string; keyChange?: string }[]; line: string; solution: { s: string; a: string; t: string; b: string }; ref?: Suggestion['ref'] } | null>(null);

  async realizeSatb() {
    const prog = this.prog().trim();
    if (!prog || this.satbBusy()) return;
    this.satbBusy.set(true);
    this.harmMsg.set({ ok: true, text: 'Realizzo a quattro voci…' });
    const s = this.song();
    const r = await api.realizeSatb({ song: s?.name, progression: prog, key: this.progKey(), bpm: String(this.bpmNum()), name: this.fileBase('-satb'), write: true });
    this.satbBusy.set(false);
    if (!r.ok) { this.harmMsg.set({ ok: false, text: r.message || 'Realizzazione non riuscita' }); return; }
    this.exercise.set(null);
    this.voices.set({ s: r.s!, a: r.a!, t: r.t!, b: r.b! });
    this.voicesOpen.set(true);
    const xml = r.files?.find((f) => /\.musicxml$/i.test(f));
    this.harmMsg.set({ ok: true, text: 'Realizzazione a quattro voci pronta (Soprano, Alto, Tenor, Bass). Partitura per Dorico:', path: xml });
    if (s) this.songs.set(await api.listSongs());
    this.runVoices();
  }

  readonly exerciseLevels = EXERCISE_LEVELS;
  exLevel = signal(1);
  private lastExercise = '';
  async newExercise() {
    const pool = exerciseModels(this.exLevel(), this.sugKey()).filter((x) => x.chords.length >= 3 && x.chords.length <= 9);
    if (!pool.length) return;
    const fresh = pool.filter((x) => x.id !== this.lastExercise);
    const pick = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    this.lastExercise = pick.id;
    this.satbBusy.set(true);
    const r = await api.realizeSatb({ progression: pick.line, key: this.sugKey(), write: false });
    this.satbBusy.set(false);
    if (!r.ok) { this.voiceReport.set({ ok: false, text: r.message || 'Esercizio non disponibile' }); return; }
    this.exercise.set({ title: pick.title, chords: pick.chords, line: pick.line, solution: { s: r.s!, a: r.a!, t: r.t!, b: r.b! }, ref: pick.ref });
    this.voices.set({ s: '', a: '', t: '', b: r.b! });
    this.voiceReport.set({ ok: true, text: `Basso dato in ${this.sugHome()}: scrivi Soprano, Alto e Tenor seguendo i gradi, poi «Controlla».` });
    this.voicesOpen.set(true);
  }
  /** Esporta l'esercizio per Dorico: basso numerato e tre righi vuoti (Soprano, Alto, Tenor). */
  async exportExercise() {
    const e = this.exercise(); if (!e) return;
    const s = this.song();
    const name = 'exercise-' + e.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const r = await api.realizeSatb({ song: s?.name, progression: e.line, key: this.sugKey(), name, write: true, exercise: true });
    if (!r.ok) { this.voiceReport.set({ ok: false, text: r.message || 'Esportazione non riuscita' }); return; }
    const xml = r.files?.find((f) => /\.musicxml$/i.test(f));
    this.harmMsg.set({ ok: true, text: 'Esercizio per Dorico (basso numerato, voci superiori da scrivere):', path: xml });
    if (s) this.songs.set(await api.listSongs());
  }

  /** Analizza un MIDI esistente e porta la progressione nella sezione corrente (da salvare a mano). */
  async analyzeMidi() {
    const r = await api.analyzeMidi(this.song()?.name);
    if (r.canceled) return;
    if (!r.ok) { this.harmMsg.set({ ok: false, text: r.message || 'Analisi non riuscita' }); return; }
    this.prog.set(r.progression || '');
    if (r.key) this.progKey.set(r.key);
    this.harmOpen.set(true);
    this.harmMsg.set({ ok: true, text: `Analisi di ${this.fileName(r.file || '')}: ${r.bars} battute, tonalità stimata ${r.key}. È un'analisi automatica (note di passaggio e ritardi possono ingannarla): controllala, poi «Salva nella memoria».` });
  }

  showSolution() { const e = this.exercise(); if (e) { this.voices.set({ ...e.solution }); this.runVoices(); } }
  playVoices() {
    const v = this.voices();
    const parts = [v.b, v.t, v.a, v.s].map((x) => x.trim().split(/\s+/).filter(Boolean).map(noteMidi));
    if (parts.some((p) => !p.length || p.some((n) => n === null)) || new Set(parts.map((p) => p.length)).size > 1) {
      this.voiceReport.set({ ok: false, text: 'Per ascoltare servono quattro voci complete con lo stesso numero di note.' }); return;
    }
    if (this.playing() === 'satb') { this.stopPlay(); return; }
    this.playing.set('satb');
    this.piano.playVoices(parts as number[][], this.bpmNum(), (i) => { if (i < 0) this.playing.set(''); });
  }

  /** Rapporto del controllo con le pagine del De Ninno cliccabili (aprono la Fonte). */
  reportHtml(t: string) {
    return linkCitations(t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  }

  async runVoices() {
    const v = this.voices();
    if (![v.s, v.a, v.t, v.b].every((x) => x.trim())) { this.voiceReport.set({ ok: false, text: 'Compila tutte e quattro le voci.' }); return; }
    this.voiceReport.set({ ok: true, text: 'Controllo…' });
    // accordi di riferimento: quelli dell'esercizio, oppure la progressione se ha tante posizioni quante le voci
    const n = v.s.trim().split(/\s+/).length;
    const e = this.exercise();
    const fromProg = this.cells().filter((c) => c.ok).map((c) => c.name);
    const chords = e ? e.chords.map((c) => c.chord) : fromProg.length === n ? fromProg : [];
    const r = await api.checkVoices({ ...v, chords: chords.join(' ') || undefined, key: e ? this.sugKey() : this.progKey() || undefined });
    const note = chords.length ? '' : 'Controllo solo della condotta: per raddoppi, sensibile e settima servono tanti accordi quante posizioni.\n\n';
    this.voiceReport.set(r.ok ? { ok: true, errors: r.errors, text: note + (r.report || '') } : { ok: false, text: r.message || 'Controllo non riuscito' });
  }

  askHarmony() {
    const cells = this.cells().filter((c) => c.ok);
    if (!cells.length) return;
    this.send(`Analizza questa progressione${this.progKey() ? ' in ' + this.progKey() : ''}: ${this.prog().trim()}. Indica funzioni, cadenze ed eventuali modulazioni, citando il De Ninno.`, 'Analisi della progressione');
  }

  askVoices() {
    const v = this.voices();
    this.send(`Controlla questo esercizio a quattro voci con tools/voice_check.py e spiega gli errori con il De Ninno.\nS: ${v.s}\nA: ${v.a}\nT: ${v.t}\nB: ${v.b}`, 'Controllo a quattro voci');
  }

  goOrchestration() { this.phaseId.set('orchestrazione'); }
  openMidi(p: string) { api.openPath(p); }

  async loadPage(book = this.book(), page = this.bookPageNo()) {
    if (!page || page < 1) return;
    this.book.set(book); this.bookPageNo.set(page);
    this.pageLoading.set(true); this.pageError.set(''); this.rightOpen.set(true);
    const r = await api.bookPage(book, page);
    this.pageLoading.set(false);
    if (r.ok && r.dataUrl) this.pageImg.set(r.dataUrl); else { this.pageImg.set(''); this.pageError.set(r.message || 'Pagina non disponibile'); }
  }
  stepPage(d: number) { this.loadPage(this.book(), Math.max(1, this.bookPageNo() + d)); }
  openBookPdf() { api.openBook(this.book()); }
  async openReader() {
    const r = await api.openReader(this.book(), this.bookPageNo());
    if (!r.ok) this.pageError.set(r.message || 'Lettore non disponibile');
  }
  bookLabel(id: string) { return BOOKS.find((b) => b.id === id)?.label ?? id; }

  onMdClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href') || '';
    const play = href.match(/^#play:(.+)$/);
    if (play) { e.preventDefault(); this.playLine(decodeURIComponent(play[1]), 'msg:' + play[1]); return; }
    const m = href.match(/^#cite:(\w+):(\d+)$/);
    if (!m) return;
    e.preventDefault();
    this.rightTab.set('src');
    this.loadPage(m[1], +m[2]);
  }

  // ---------- pianoforte ----------
  private piano = new Piano();
  playing = signal('');                 // sorgente in riproduzione: 'prog', id di un suggerimento, 'msg:…'
  nowIdx = signal(-1);
  playStyle = signal<Style>('block');
  loop = signal(false);
  bpmNum = computed(() => +this.progBpm() || +((this.song()?.tempo.match(/(\d+)\s*BPM/i) || [])[1] || 0) || 90);

  private progChords() {
    return this.cells().map((c, idx) => ({ idx, ct: c.ok ? chordTones(`${c.name}:${c.beats}`, this.beatsPerBar()) : null }))
      .filter((x): x is { idx: number; ct: ChordTones } => !!x.ct);
  }
  togglePlay() {
    if (this.playing() === 'prog') { this.stopPlay(); return; }
    const list = this.progChords();
    if (!list.length) return;
    this.playing.set('prog');
    this.piano.play(list.map((x) => x.ct), { bpm: this.bpmNum(), style: this.playStyle(), loop: this.loop() }, (i) => {
      if (i < 0) { this.playing.set(''); this.nowIdx.set(-1); } else this.nowIdx.set(list[i].idx);
    });
  }
  previewCell(idx: number) {
    this.insertAfter.set(idx);
    const list = this.progChords();
    const k = list.findIndex((x) => x.idx === idx);
    if (k < 0) return;
    this.piano.chord(list[k].ct, list[k - 1]?.ct);
  }
  playLine(line: string, source: string) {
    if (this.playing() === source) { this.stopPlay(); return; }
    const chords = parseProgression(line, this.beatsPerBar());
    if (!chords.length) return;
    this.playing.set(source);
    this.nowIdx.set(-1);
    this.piano.play(chords, { bpm: this.bpmNum(), style: this.playStyle(), loop: false }, (i) => {
      if (i < 0) { this.playing.set(''); this.sugIdx.set(-1); } else this.sugIdx.set(i);
    });
  }
  sugIdx = signal(-1);

  // Uscita: pianoforte interno oppure una porta MIDI (Komplete Kontrol con The Grandeur, BBCSO Piano…)
  midiOutputs = signal<{ id: string; name: string }[]>([]);
  soundId = signal('internal');
  midiError = signal('');
  private midiAccess: MIDIAccess | null = null;
  async loadMidi() {
    if (this.midiAccess || !navigator.requestMIDIAccess) return;
    try {
      this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      const refresh = () => {
        const list = [...this.midiAccess!.outputs.values()].filter((o) => !/GS Wavetable/i.test(o.name || ''))
          .map((o) => ({ id: o.id, name: o.name || o.id }));
        this.midiOutputs.set(list);
        if (this.soundId() !== 'internal' && !list.some((o) => o.id === this.soundId())) this.setSound('internal');
      };
      this.midiAccess.onstatechange = refresh;
      refresh();
      let saved = ''; try { saved = localStorage.getItem(LS + '.sound') || ''; } catch { /* ignora */ }
      const hit = this.midiOutputs().find((o) => o.name === saved);
      if (hit) this.setSound(hit.id);
      else if (!saved) {                       // primo avvio: se c'è la porta di loopMIDI «Studio Agent» la usa
        const lp = this.midiOutputs().find((o) => /studio agent|loopmidi/i.test(o.name));
        if (lp) this.setSound(lp.id);
      }
      try { const cm = localStorage.getItem(LS + '.channels') as ChannelMode | null; if (cm) this.setChanMode(cm); } catch { /* ignora */ }
    } catch (e: any) { this.midiError.set('MIDI non disponibile: ' + (e?.message || e)); }
  }
  setSound(id: string) {
    this.stopPlay();
    this.soundId.set(id);
    const out = id === 'internal' ? null : this.midiAccess?.outputs.get(id) ?? null;
    this.piano.setMidiOutput(out);
    try { localStorage.setItem(LS + '.sound', out?.name || ''); } catch { /* ignora */ }
  }
  chanMode = signal<ChannelMode>('single');
  setChanMode(m: ChannelMode) {
    this.stopPlay();
    this.chanMode.set(m);
    this.piano.channelMode = m;
    try { localStorage.setItem(LS + '.channels', m); } catch { /* ignora */ }
  }
  testSound() { this.piano.testNote(); }
  async refreshMidi() { this.midiAccess = null; await this.loadMidi(); }

  // ---------- forma del brano e arrangiamento (tools/arrange.py) ----------
  readonly arrStyles = [
    { id: 'pop', label: 'Pop' }, { id: 'ballad', label: 'Ballata' }, { id: 'rock', label: 'Rock' },
    { id: 'waltz', label: 'Valzer (3/4)' }, { id: 'arpeggio', label: 'Arpeggio (chitarra)' }, { id: 'chorale', label: 'Corale' },
  ];
  readonly melodyInstruments = ['Flute', 'Violin', 'Oboe', 'Clarinet', 'Trumpet', 'Vibraphone', 'Electric Piano', 'Acoustic Guitar', 'Lead Synth', 'Choir Aahs'];
  formOpen = signal(false);
  formList = signal<string[]>([]);
  arrStyle = signal('pop');
  arrMelody = signal(true);
  arrInstrument = signal('Flute');
  arrBusy = signal(false);
  arrMsg = signal<{ ok: boolean; text: string; path?: string } | null>(null);
  arrPos = signal(-1);
  private arrMarkers = signal<{ t: number; name: string }[]>([]);
  private arrBeats = signal(4);
  arrSection = computed(() => {
    const p = this.arrPos(); if (p < 0) return '';
    const ms = this.arrMarkers().filter((m) => m.t <= p + 1e-6);
    return ms.length ? `${ms[ms.length - 1].name} · b. ${Math.floor(p / this.arrBeats()) + 1}` : '';
  });
  /** Nomi utilizzabili nella forma: le sezioni con una progressione («Main» è la principale). */
  formNames = computed(() => this.sectionTabs().filter((t) => t.progression || t.section).map((t) => t.section || 'Main'));
  formDirty = computed(() => this.formList().join(' ') !== (this.song()?.form || '').split(/[\s,]+/).filter(Boolean).join(' '));
  addToForm(n: string) { if (n) this.formList.update((l) => [...l, n]); }
  removeFromForm(i: number) { this.formList.update((l) => l.filter((_, k) => k !== i)); }
  moveInForm(i: number, d: number) {
    this.formList.update((l) => {
      const j = i + d; if (j < 0 || j >= l.length) return l;
      const c = [...l]; [c[i], c[j]] = [c[j], c[i]]; return c;
    });
  }
  async saveForm() {
    const s = this.song(); if (!s) return;
    try { this.replaceSong(await api.setForm(s.name, this.formList().join(' '))); this.arrMsg.set({ ok: true, text: 'Forma salvata nella memoria del brano.' }); }
    catch (e: any) { this.arrMsg.set({ ok: false, text: this.errText(e) }); }
  }
  async arrange(write: boolean) {
    const s = this.song();
    if (!s) { this.arrMsg.set({ ok: false, text: 'Apri un brano: forma e sezioni si leggono dalla sua memoria.' }); return; }
    if (this.progDirty()) { this.arrMsg.set({ ok: false, text: `Salva prima la progressione «${this.sectionLabel(this.section())}»: l'arrangiamento usa quelle salvate nella memoria del brano.` }); return; }
    if (!write && this.playing() === 'arr') { this.stopPlay(); return; }
    this.arrBusy.set(true);
    const r = await api.arrange({ song: s.name, style: this.arrStyle(), melody: this.arrMelody(), instrument: this.arrInstrument(), form: this.formList().join(' '), write });
    this.arrBusy.set(false);
    if (!r.ok) { this.arrMsg.set({ ok: false, text: r.message || 'Arrangiamento non riuscito' }); return; }
    const notes: string[] = [];
    if (r.auto?.length) notes.push(`ricavate in automatico: ${r.auto.join(', ')}`);
    if (r.missing?.length) notes.push(`senza progressione, saltate: ${r.missing.join(', ')}`);
    const info = `${(r.form || []).join(' → ')} · ${Math.round((r.length || 0) / (r.beatsPerBar || 4))} battute${notes.length ? ' (' + notes.join('; ') + ')' : ''}`;
    if (write) {
      this.arrMsg.set({ ok: true, text: `MIDI del brano pronto: ${info}. Tracce ${this.arrMelody() ? this.arrInstrument() + ', ' : ''}Piano, Electric Bass, Drums e marker delle sezioni:`, path: r.file || undefined });
      this.songs.set(await api.listSongs());
      return;
    }
    this.arrMsg.set({ ok: true, text: info });
    this.arrMarkers.set(r.markers || []);
    this.arrBeats.set(r.beatsPerBar || 4);
    this.playing.set('arr');
    this.piano.playEvents(r.notes || [], r.cc || [], r.bpm || this.bpmNum(), (pos) => {
      if (pos < 0) { if (this.playing() === 'arr') this.playing.set(''); this.arrPos.set(-1); } else this.arrPos.set(pos);
    });
  }

  soundName = computed(() => this.midiOutputs().find((o) => o.id === this.soundId())?.name ?? 'Pianoforte interno');
  /** La porta della tastiera manda le note allo strumento fisico, non al software Komplete Kontrol. */
  soundHint = computed(() => {
    const n = this.soundName();
    if (/^KOMPLETE KONTROL( EXT)? - \d/i.test(n)) return 'Questa porta va alla tastiera Komplete Kontrol, non al programma: per sentire The Grandeur o BBCSO Piano usa una porta virtuale (loopMIDI) attivata come ingresso in Komplete Kontrol.';
    if (/Komplete Kontrol DAW/i.test(n)) return 'Porta di integrazione DAW della tastiera: non suona lo strumento.';
    if (/UR816|UR-C/i.test(n)) return 'Uscita MIDI fisica della UR816 (DIN): suona solo se c\'è uno strumento collegato al connettore MIDI OUT.';
    if (n === 'Pianoforte interno') return '';
    return this.chanMode() === 'separate'
      ? 'Canali separati: Piano 1, Electric Bass 2, melodia 3, Drums 10. Komplete Kontrol suona tutti i canali con lo stesso strumento: per timbri diversi usa Kontakt in modalità multi o Cubase. In Komplete Kontrol: Preferenze → MIDI → attiva questa porta come ingresso.'
      : 'Un solo canale: tutto sul canale 1 con lo strumento caricato (es. The Grandeur), batteria esclusa. In Komplete Kontrol: Preferenze → MIDI → attiva questa porta come ingresso.';
  });
  stopPlay() { this.piano.stop(); this.playing.set(''); this.nowIdx.set(-1); this.sugIdx.set(-1); this.arrPos.set(-1); }

  // ---------- sviluppi armonici ----------
  readonly compTypes = COMPOSITION_TYPES;
  readonly techniques = Object.entries(TECHNIQUES) as [Technique, string][];
  rightTab = signal<'dev' | 'src'>('dev');
  techFilter = signal<Technique | ''>('');
  private typeOverride = signal<CompositionType | null>(null);
  compType = computed<CompositionType>(() => this.typeOverride() ?? typeFromText(this.song()?.compositionType || ''));
  typeLabel = computed(() => COMPOSITION_TYPES.find((c) => c.id === this.compType())!.label);
  sugKey = computed(() => this.progKey() || keyForMidi(this.song()?.key || '') || 'C');
  sugHome = computed(() => homeLabel(this.sugKey()));
  suggestions = computed(() => suggest(this.sugKey(), this.compType(), this.techFilter() || undefined));
  techLabel(t: Technique) { return TECHNIQUES[t]; }
  numerals(s: Suggestion) { return s.chords.map((c) => c.numeral).join(' '); }

  async setType(t: CompositionType) {
    this.typeOverride.set(t);
    const s = this.song();
    if (!s) return;
    try { this.replaceSong(await api.setCompositionType(s.name, COMPOSITION_TYPES.find((c) => c.id === t)!.label)); this.typeOverride.set(null); }
    catch (e: any) { this.harmMsg.set({ ok: false, text: this.errText(e) }); }
  }
  addSuggestion(s: Suggestion) {
    const cur = this.prog().trim();
    const at = this.insertAfter();
    if (at < 0 || at >= this.cells().length - 1) {
      this.prog.set(cur ? `${cur} | ${s.line}` : s.line);
    } else {
      // inserisce dopo l'accordo scelto, tra due separatori di gruppo
      const toks = cur.replace(/\|/g, ' | ').split(/\s+/).filter(Boolean);
      let seen = -1, pos = toks.length;
      for (let k = 0; k < toks.length; k++) if (toks[k] !== '|' && ++seen === at) { pos = k + 1; break; }
      toks.splice(pos, 0, '|', ...s.line.split(' '), '|');
      this.prog.set(toks.join(' ').replace(/(\|\s*)+\|/g, '|').replace(/^\|\s*|\s*\|$/g, '').trim());
    }
    this.harmOpen.set(true);
    this.harmMsg.set({ ok: true, text: `Aggiunto «${s.title}» ${this.insertLabel()}.` });
    this.insertAfter.set(-1);
  }
  replaceWith(s: Suggestion) {
    this.prog.set(s.line);
    this.harmOpen.set(true);
    this.harmMsg.set({ ok: true, text: `La progressione ora è «${s.title}». «Salva nella memoria» per tenerla.` });
  }
  askSuggestion(s: Suggestion) {
    const mods = s.keyChanges.length ? ` Modula a: ${s.keyChanges.join(', ')}.` : '';
    this.send(`Valuta lo sviluppo «${s.title}» per questo brano (${this.typeLabel()}): \`${s.line}\` (gradi in ${this.sugHome()}: ${this.numerals(s)}).${mods} `
      + `Spiega condotta delle parti, preparazione e risoluzione delle dissonanze (settime, ritardi, alterazioni) e dove inserirlo rispetto alla progressione attuale${this.prog().trim() ? ' `' + this.prog().trim() + '`' : ''}. `
      + `Cita il De Ninno e scrivi la progressione risultante tra backtick con simboli inglesi.`, `Sviluppo: ${s.title}`);
  }
  askAgentSuggestions() {
    const p = this.prog().trim();
    this.send(`Proponi tre possibili sviluppi armonici${p ? ` per la progressione \`${p}\`` : ''} in ${this.sugHome()}, adatti a: ${this.typeLabel()}. `
      + `Usa tecniche avanzate (modulazioni con accordo perno o enarmoniche, cadenze evitate, risoluzioni delle settime, ritardi, sesta napoletana e seste aumentate, pedali) scelte in base al tipo di composizione. `
      + `Per ciascuno: la progressione tra backtick con simboli inglesi (es. \`Dm7/F G7 Am\`), i gradi, la condotta delle parti e la pagina del De Ninno.`, 'Sviluppi armonici dall\'agente');
  }
  openRef(s: Suggestion) { if (s.ref) { this.rightTab.set('src'); this.loadPage(s.ref.book, s.ref.page); } }

  private errText(e: any) { return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }

  producedFiles = computed(() => (this.song()?.files ?? [])
    .filter((f) => ['midi', 'score', 'notes', 'reports'].includes(f.kind) && !/\.json$/i.test(f.name))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)));
  kindLabel(k: string) { return ({ midi: 'MIDI', score: 'partitura', notes: 'checklist', reports: 'rapporto' } as Record<string, string>)[k] ?? k; }
  openFile(p: string) { api.openPath(p); }

  // ---------- consumi ----------
  sessionTokens = computed(() => {
    const since = this.sessionStart;
    return this.usage().filter((u) => u.ts >= since).reduce((a, u) => a + u.input + u.output, 0);
  });
  private sessionStart = new Date().toISOString();
  songTokens = computed(() => this.usage().filter((u) => u.song === this.songName()).reduce((a, u) => a + u.input + u.output, 0));

  periodUsage = computed(() => {
    const p = this.period();
    const now = Date.now();
    const lim = p === 'day' ? 864e5 : p === 'week' ? 7 * 864e5 : p === 'month' ? 30 * 864e5 : Infinity;
    return this.usage().filter((u) => now - Date.parse(u.ts) <= lim);
  });
  stats = computed(() => {
    const list = this.periodUsage();
    const total = list.reduce((a, u) => a + u.input + u.output, 0);
    const input = list.reduce((a, u) => a + u.input, 0);
    const output = list.reduce((a, u) => a + u.output, 0);
    const group = (key: (u: UsageEntry) => string) => {
      const m = new Map<string, number>();
      for (const u of list) m.set(key(u) || '—', (m.get(key(u) || '—') ?? 0) + u.input + u.output);
      const arr = [...m.entries()].sort((a, b) => b[1] - a[1]);
      const max = arr[0]?.[1] || 1;
      return arr.map(([label, v]) => ({ label, v, pct: Math.max(2, (v / max) * 100) }));
    };
    const phaseName = (id: string) => [...PHASES, ...EXTRA].find((p) => p.id === id)?.label ?? id;
    const heavy = list.reduce((a, u) => Math.max(a, u.input + u.output), 0);
    return {
      total, input, output, count: list.length, avg: list.length ? total / list.length : 0, heavy,
      inPct: total ? Math.round((input / total) * 100) : 0,
      byAgent: group((u) => u.agent), bySong: group((u) => u.song || 'Senza brano'), byPhase: group((u) => phaseName(u.phase)),
    };
  });
  rows = computed(() => {
    const f = this.filter().toLowerCase().trim();
    return [...this.periodUsage()].reverse().filter((u) => !f || `${u.request} ${u.agent} ${u.song}`.toLowerCase().includes(f)).slice(0, 200);
  });
  k(n: number) {
    if (n >= 1e6) return (n / 1e6).toFixed(2).replace('.', ',') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace('.', ',') + 'k';
    return String(Math.round(n));
  }
  resetText(sec: number) {
    const d = new Date(sec * 1000); const today = new Date();
    const same = d.toDateString() === today.toDateString();
    return (same ? 'alle ' : d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }) + ' alle ') + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  dur(ms: number) { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`; }
  when(ts: string) { const d = new Date(ts); return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }

  async openUsage() { this.usage.set(await api.usage()); this.view.set('usage'); }
}
