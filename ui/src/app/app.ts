import { Component, computed, effect, signal, untracked, ChangeDetectionStrategy, ElementRef, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { api, isDemo, AgentEvent, Song, UsageEntry, Limits } from './api';
import { mdToHtml, firstSentence, linkCitations, linkChordLines } from './md';
import { analyze as analyzeProg, keyForMidi, BOOKS, chordTones, parseProgression, isChordLine, ChordTones } from './harmony';
import { Piano, Style } from './piano';
import { suggest, COMPOSITION_TYPES, TECHNIQUES, typeFromText, homeLabel, CompositionType, Technique, Suggestion } from './suggestions';

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
    this.measuring.set(true);
    this.measureError.set('');
    this.rightOpen.set(true);
    const r = await api.analyze(path);
    this.measuring.set(false);
    if (r.ok && r.data) this.measure.set(r.data); else { this.measure.set(null); this.measureError.set(r.message || 'Analisi non riuscita'); }
  }
  async pick() { const p = await api.pickAudio(); if (p) this.analyze(p); }
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


  // ---------- armonia ----------
  readonly books = BOOKS;
  harmOpen = signal(true);
  prog = signal('');
  progKey = signal('');
  progBpm = signal('');
  cells = computed(() => analyzeProg(this.prog(), this.progKey(), this.beatsPerBar()));
  beatsPerBar = computed(() => { const m = (this.song()?.tempo || '').match(/(\d+)\s*\/\s*4/); return m ? +m[1] : 4; });
  progDirty = computed(() => (this.song()?.progression || '') !== this.prog().trim());
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
    this.prog.set(s?.progression || '');
    this.progKey.set(keyForMidi(s?.key || '') || '');
    this.progBpm.set((s?.tempo.match(/(\d+)\s*BPM/i) || [])[1] || '');
    this.harmMsg.set(null);
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
    try { this.replaceSong(await api.setProgression(s.name, this.prog().trim())); this.harmMsg.set({ ok: true, text: 'Progressione salvata nella memoria del brano.' }); }
    catch (e: any) { this.harmMsg.set({ ok: false, text: this.errText(e) }); }
  }

  async exportMidi() {
    if (!this.prog().trim()) return;
    this.harmMsg.set({ ok: true, text: 'Creo il file MIDI…' });
    const s = this.song();
    const r = await api.exportMidi({ song: s?.name, progression: this.prog().trim(), bpm: this.progBpm(), key: this.progKey(), name: 'progression' });
    this.harmMsg.set(r.ok ? { ok: true, text: 'MIDI pronto: tracce Melody, Strings, Piano, Electric Bass, Drums.', path: r.path } : { ok: false, text: r.message || 'Esportazione non riuscita' });
    if (r.ok) this.songs.set(await api.listSongs());
  }

  async runVoices() {
    const v = this.voices();
    if (![v.s, v.a, v.t, v.b].every((x) => x.trim())) { this.voiceReport.set({ ok: false, text: 'Compila tutte e quattro le voci.' }); return; }
    this.voiceReport.set({ ok: true, text: 'Controllo…' });
    const r = await api.checkVoices(v);
    this.voiceReport.set(r.ok ? { ok: true, errors: r.errors, text: r.report || '' } : { ok: false, text: r.message || 'Controllo non riuscito' });
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
  stopPlay() { this.piano.stop(); this.playing.set(''); this.nowIdx.set(-1); this.sugIdx.set(-1); }

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
    this.prog.set(cur ? `${cur} | ${s.line}` : s.line);
    this.harmOpen.set(true);
    this.harmMsg.set({ ok: true, text: `Aggiunto «${s.title}» in coda alla progressione.` });
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
