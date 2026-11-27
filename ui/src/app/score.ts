// Partitura integrata della fase Orchestrazione: legge score/*.musicxml con il MIDI gemello,
// la mostra (OpenSheetMusicDisplay) e la fa ascoltare con un soundfont GM o su una porta MIDI; il cursore segue l'ascolto.
import { Component, ChangeDetectionStrategy, ElementRef, OnDestroy, computed, effect, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { api, isDemo, SongFile } from './api';
import { MidiInfo, MidiPart, ScorePair, clock, pairScores, quartersToSec, readMidi, secToQuarters, stepAt } from './score-time';
import { ScoreEngine } from './score-audio';
import { Player, PortPlayer } from './score-ports';

export interface BbcsoPart { part: string; port: string; preset: string | null; articulations: Record<string, number>; missing: string[]; }

const LS = 'studio-agent.ui.score';
const lsGet = (k: string) => { try { return localStorage.getItem(LS + k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(LS + k, v); } catch { /* ignora */ } };

@Component({
  selector: 'app-score',
  imports: [FormsModule],
  templateUrl: './score.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:resize)': 'onResize()' },
})
export class ScoreView implements OnDestroy {
  song = input('');
  files = input<SongFile[]>([]);
  sheet = viewChild<ElementRef<HTMLDivElement>>('sheet');

  readonly clock = clock;
  readonly rates = [0.5, 0.75, 1, 1.25];
  pairs = computed(() => pairScores(this.files()));
  sel = signal(lsGet('.sel') ?? '');
  current = computed<ScorePair | undefined>(() => this.pairs().find((p) => p.name === this.sel()) ?? this.pairs()[0]);
  private currentKey = computed(() => { const p = this.current(); return p ? [p.name, p.xml, p.mid, p.stamp].join('|') : ''; });

  open = signal(lsGet('.open') !== '0');
  height = signal(+(lsGet('.height') || 0) || 0);
  winH = signal(typeof window !== 'undefined' ? window.innerHeight : 900);
  /** Altezza effettiva: quella scelta, o quasi tutto lo spazio; lascia sempre posto al consulto e al messaggio. */
  effHeight = computed(() => { const max = Math.max(240, this.winH() - 420); return Math.max(240, Math.min(this.height() || max, max)); });

  msg = signal('');
  busy = signal('');
  playing = signal(false);
  pos = signal(0);
  dur = signal(0);
  measure = signal(0);
  measures = signal(0);
  rate = signal(+(lsGet('.rate') || 1) || 1);
  zoom = signal(+(lsGet('.zoom') || 0.75) || 0.75);
  parts = signal<MidiPart[]>([]);
  muted = signal<number[]>([]);
  outputs = signal<{ id: string; name: string }[]>([]);
  output = signal(lsGet('.output') ?? 'sf');
  bank = signal('');
  follow = signal(lsGet('.follow') !== '0');
  bbcso = signal<{ edition: string; parts: BbcsoPart[]; missing: string[] } | null>(null);

  private osmd: OpenSheetMusicDisplay | null = null;
  private info: MidiInfo | null = null;
  private mid: Uint8Array | null = null;
  private loadedMid = '';
  private player: Player | null = null;
  private userScroll = 0;
  private autoScroll = 0;
  private steps: number[] = [];
  private stepMeasures: number[] = [];
  private cur = 0;
  private raf = 0;
  private token = 0;
  private midiAccess: MIDIAccess | null = null;

  constructor() {
    effect(() => {
      this.currentKey();                       // si ricarica solo se cambia il file (o lo rigenera l'agente)
      const o = this.open();
      untracked(() => { if (o) void this.load(this.current()); });
    });
  }

  ngOnDestroy() { this.stopLoop(); this.player?.pause(); }

  onResize() { this.winH.set(window.innerHeight); }
  toggle() { this.open.update((v) => !v); lsSet('.open', this.open() ? '1' : '0'); }
  select(name: string) { this.sel.set(name); lsSet('.sel', name); }

  // ---------- caricamento ----------
  private async load(p: ScorePair | undefined) {
    const my = ++this.token;
    this.halt();
    this.msg.set(''); this.parts.set([]); this.muted.set([]); this.loadedMid = ''; this.info = null; this.mid = null; this.dur.set(0); this.pos.set(0); this.measure.set(0);
    if (!p) { this.osmd?.clear(); return; }
    if (p.mid) {
      const bytes = await api.readFile(p.mid);
      if (my !== this.token) return;
      if (bytes) {
        try {
          this.mid = bytes; this.info = readMidi(bytes);
          this.parts.set(this.info.parts);
          this.dur.set(quartersToSec(this.info, this.info.endTick / this.info.tpq));
        } catch { this.msg.set('Il file MIDI non si legge: rigeneralo con tools/score.py.'); }
      }
    }
    if (!p.xml) { this.osmd?.clear(); this.msg.set(`C'è solo il MIDI di «${p.name}»: per vedere la partitura serve il MusicXML (tools/score.py lo scrive insieme al MIDI).`); return; }
    this.busy.set('Preparo la partitura…');
    try {
      const bytes = await api.readFile(p.xml);
      if (!bytes) throw new Error('file non leggibile');
      const osmd = await this.ensureOsmd();
      if (my !== this.token) return;
      await osmd.load(new TextDecoder().decode(bytes));
      if (my !== this.token) return;
      osmd.zoom = this.zoom();
      osmd.render();
      this.buildSteps();
      if (!p.mid) this.msg.set(`Manca «${p.name}.mid»: la partitura si vede ma non si ascolta.`);
    } catch (e) {
      this.msg.set(`La partitura non si apre (${(e as Error).message}). Se viene da Dorico, esportala come MusicXML non compresso.`);
    } finally { if (my === this.token) this.busy.set(''); }
  }

  private async ensureOsmd(): Promise<OpenSheetMusicDisplay> {
    if (this.osmd) return this.osmd;
    const host = this.sheet()?.nativeElement;
    if (!host) throw new Error('vista non pronta');
    const mod: any = await import('opensheetmusicdisplay');
    const Osmd: typeof OpenSheetMusicDisplay = mod.OpenSheetMusicDisplay ?? mod.default?.OpenSheetMusicDisplay ?? mod.default;
    this.osmd = new Osmd(host, {
      autoResize: true, backend: 'svg', drawTitle: true, drawSubtitle: true, drawComposer: true, drawCredits: false,
      drawPartNames: true, drawPartAbbreviations: true, followCursor: false,
      cursorsOptions: [{ type: 0, color: '#d9480f', alpha: 0.45, follow: false }],
      onRender: () => this.afterRender(),
    });
    return this.osmd;
  }

  /** Posizioni (in quarti) di ogni passo del cursore e battuta corrispondente. */
  private buildSteps() {
    const c = this.osmd!.cursor;
    c.show(); c.reset();
    const steps: number[] = [], ms: number[] = [];
    let guard = 0;
    while (!c.Iterator.EndReached && guard++ < 50000) {
      steps.push(c.Iterator.currentTimeStamp.RealValue * 4);
      ms.push(c.Iterator.CurrentMeasureIndex + 1);
      c.Iterator.moveToNext();
    }
    this.steps = steps.length ? steps : [0];
    this.stepMeasures = ms.length ? ms : [1];
    this.measures.set(Math.max(0, ...ms));
    c.reset(); this.cur = 0;
    this.measure.set(this.stepMeasures[0]);
    if (!this.dur() && this.osmd) this.dur.set(0);
  }

  private afterRender() {
    const c = this.osmd?.cursor;
    if (!c || !this.steps.length) return;
    // dopo un nuovo disegno (zoom, larghezza) rimette il cursore dove stava
    const k = this.cur; c.reset(); this.cur = 0; this.moveTo(k);
  }

  // ---------- cursore ----------
  private moveTo(k: number, force = false) {
    const c = this.osmd?.cursor;
    if (!c) return;
    if (k < this.cur) { c.reset(); this.cur = 0; }
    const moved = k !== this.cur;
    while (this.cur < k && !c.Iterator.EndReached) { c.next(); this.cur++; }
    c.update();
    this.measure.set(this.stepMeasures[this.cur] ?? this.measure());
    if (moved || force) this.followCursor(force);
  }
  /** Porta in vista il cursore, ma non se hai appena fatto scorrere la partitura a mano (6 s) o se «segui» è spento. */
  private followCursor(force = false) {
    const box = this.sheet()?.nativeElement, el = this.osmd?.cursor?.cursorElement;
    if (!box || !el) return;
    if (!force && (!this.follow() || performance.now() - this.userScroll < 6000)) return;
    const top = el.offsetTop, h = el.offsetHeight || 60;
    if (top < box.scrollTop + 10 || top + h > box.scrollTop + box.clientHeight - 10) {
      this.autoScroll = performance.now();
      box.scrollTo({ top: Math.max(0, top - 24), behavior: this.playing() ? 'smooth' : 'auto' });
    }
  }
  /** Scorrimento della partitura: se non l'ha fatto il cursore, l'hai fatto tu. */
  onSheetScroll() { if (performance.now() - this.autoScroll > 900) this.userScroll = performance.now(); }
  onSheetWheel() { this.userScroll = performance.now(); }
  toggleFollow() {
    this.follow.update((v) => !v); lsSet('.follow', this.follow() ? '1' : '0');
    if (this.follow()) { this.userScroll = 0; this.followCursor(true); }
  }
  private syncTo(sec: number) {
    this.pos.set(sec);
    if (!this.info || !this.osmd) return;
    this.moveTo(stepAt(this.steps, secToQuarters(this.info, sec)));
  }

  /** Clic su una battuta: l'ascolto riparte da lì. */
  onSheetClick(ev: MouseEvent) {
    const osmd = this.osmd, box = this.sheet()?.nativeElement;
    if (!osmd || !box || !this.info) return;
    const svg = box.querySelector('svg');
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const unit = 10 * osmd.zoom;
    const x = (ev.clientX - r.left) / unit, y = (ev.clientY - r.top) / unit;
    try {
      // la battuta sotto il clic, o la più vicina in verticale nello stesso sistema (clic tra i pentagrammi)
      let best: { q: number; d: number } | null = null;
      for (const row of osmd.GraphicSheet.MeasureList) {
        for (const m of row) {
          if (!m) continue;
          const ps = m.PositionAndShape, a = ps.AbsolutePosition;
          if (x < a.x || x > a.x + ps.Size.width) continue;
          const d = y < a.y ? a.y - y : y > a.y + ps.Size.height ? y - a.y - ps.Size.height : 0;
          if (!best || d < best.d) best = { q: m.parentSourceMeasure.AbsoluteTimestamp.RealValue * 4, d };
        }
      }
      if (best && best.d < 12) void this.seek(quartersToSec(this.info, best.q), false);
    } catch { /* struttura interna diversa: ignora il clic */ }
  }

  // ---------- ascolto ----------
  private async engine(): Promise<Player | null> {
    const p = this.current();
    if (!p) return null;
    if (this.output() === 'bbcso') return this.bbcsoPlayer(p);
    if (!this.mid || !p.mid) return null;
    let e: ScoreEngine;
    try {
      if (!this.bank()) this.busy.set('Carico il soundfont (la prima volta qualche secondo)…');
      e = await ScoreEngine.get();
      this.bank.set(e.bank);
    } catch (err) { this.busy.set(''); this.msg.set((err as Error).message); return null; }
    const key = 'sf|' + p.mid + '|' + p.stamp;
    if (this.loadedMid !== key) {
      this.busy.set('Preparo l\'ascolto…');
      const d = await e.load(this.mid, p.name + '.mid');
      if (d > 0) this.dur.set(d);
      this.loadedMid = key;
    }
    e.setRate(this.rate());
    e.setMuted(this.muted(), this.mutedNames());
    e.setOutput(await this.port());
    this.busy.set('');
    this.player = e;
    return e;
  }

  /** BBCSO in Cubase: MIDI con i key switch delle expression map (rigenerato se la partitura è più recente), una porta per strumento. */
  private async bbcsoPlayer(p: ScorePair): Promise<Player | null> {
    if (!p.json && !p.bbcso) { this.msg.set(`Per BBCSO serve la sorgente «${p.name}.json» di tools/score.py accanto alla partitura.`); return null; }
    let file = p.bbcso;
    const stale = !p.bbcso || (p.jsonTime ?? 0) > (p.bbcsoTime ?? 0);
    const key = 'bbcso|' + (p.json ?? p.bbcso) + '|' + p.jsonTime + '|' + p.bbcsoTime;
    if (this.loadedMid !== key || !this.player) {
      if (stale && p.json) {
        this.busy.set('Preparo il MIDI per BBCSO con le expression map…');
        const r = await api.scoreBbcso(p.json);
        if (!r.ok) { this.busy.set(''); this.msg.set(r.message ?? 'tools/bbcso.py non è riuscito.'); return null; }
        file = r.file;
        this.bbcso.set({ edition: r.edition ?? '', parts: r.parts ?? [], missing: [] });
      }
      const bytes = file ? await api.readFile(file) : null;
      if (!bytes) { this.busy.set(''); this.msg.set('Il MIDI per BBCSO non si legge.'); return null; }
      await this.refreshOutputs();
      if (!this.midiAccess) { this.busy.set(''); this.msg.set('MIDI non disponibile: il MIDI per BBCSO è pronto, ma non posso mandarlo alle porte.'); return null; }
      this.player?.pause();
      this.player = new PortPlayer(bytes, this.midiAccess);
      this.loadedMid = key;
    }
    const pp = this.player as PortPlayer;
    const missing = pp.resolve();
    const ports = [...new Set(pp.tracks.map((t) => t.port))];
    this.bbcso.update((b) => ({ edition: b?.edition ?? '', parts: b?.parts ?? pp.tracks.map((t) => ({ part: t.name, port: t.port, preset: null, articulations: {}, missing: [] })), missing }));
    this.busy.set('');
    if (missing.length === ports.length) {
      this.msg.set(`Nessuna porta BBCSO trovata (${missing.join(', ')}): crea le porte in loopMIDI e apri il progetto Cubase BBCSO (guida: docs/bbcso-cubase.md).`);
      return null;
    }
    this.msg.set(missing.length ? `Mancano le porte ${missing.join(', ')}: quelle parti non suonano.` : '');
    pp.setRate(this.rate());
    pp.setMuted(this.muted(), this.mutedNames());
    return pp;
  }
  artList(x: BbcsoPart) { return Object.entries(x.articulations).map(([k, v]) => `${k} ×${v}`).join(', ') || '—'; }
  private mutedNames() { return this.parts().filter((x) => this.muted().includes(x.channel)).map((x) => x.name); }

  async togglePlay() {
    if (this.playing()) { this.halt(); return; }
    const e = await this.engine();
    if (!e) return;
    if (e.duration > 0 && this.output() === 'bbcso') this.dur.set(Math.max(this.dur(), e.duration));
    if (this.pos() >= this.dur() - 0.05) this.pos.set(0);
    this.userScroll = 0;
    e.time = this.pos();
    await e.play();
    this.playing.set(true);
    this.loop(e);
  }
  private loop(e: Player) {
    this.stopLoop();
    const t0 = performance.now();
    const tick = () => {
      // il sequencer gira nel worklet: subito dopo play() o un salto, tempo e stato arrivano con un attimo di ritardo
      const settling = performance.now() - t0 < 400;
      const t = e.time;
      if (!settling) this.syncTo(t);
      if (!settling && (e.paused || t >= this.dur() - 0.03)) {   // fine del brano: lascia sfumare le code e torna all'inizio
        if (!e.paused) e.finish();
        this.playing.set(false); this.syncTo(0); return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  private stopLoop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  /** Pausa: il cursore resta dov'è. */
  halt() {
    this.stopLoop();
    if (this.playing()) this.player?.pause();
    this.playing.set(false);
  }
  stop() { this.halt(); this.syncTo(0); }
  async seek(sec: number, scroll = true) {
    sec = Math.max(0, Math.min(sec, this.dur()));
    if (scroll) this.userScroll = 0;
    this.syncTo(sec);
    const e = this.player;
    if (this.playing() && e) { e.time = sec; this.loop(e); }
  }
  setRate(r: number) { this.rate.set(r); lsSet('.rate', String(r)); this.player?.setRate(r); }
  setZoom(d: number) {
    const z = Math.round(Math.max(0.4, Math.min(1.6, this.zoom() + d)) * 100) / 100;
    this.zoom.set(z); lsSet('.zoom', String(z));
    if (this.osmd) { this.osmd.zoom = z; this.osmd.render(); }
  }

  // ---------- parti ----------
  isMuted(ch: number) { return this.muted().includes(ch); }
  toggleMute(ch: number, ev?: MouseEvent) {
    const all = this.parts().map((p) => p.channel);
    const soloed = !this.isMuted(ch) && this.muted().length === all.length - 1;
    if (ev?.altKey) this.muted.set(soloed ? [] : all.filter((c) => c !== ch));
    else this.muted.update((m) => (m.includes(ch) ? m.filter((c) => c !== ch) : [...m, ch]));
    this.player?.setMuted(this.muted(), this.mutedNames());
  }
  solo(ch: number) { this.toggleMute(ch, { altKey: true } as MouseEvent); }

  // ---------- uscita ----------
  async refreshOutputs() {
    try {
      this.midiAccess ??= await navigator.requestMIDIAccess({ sysex: false });
      this.outputs.set([...this.midiAccess.outputs.values()].map((o) => ({ id: o.id, name: o.name ?? o.id })));
    } catch { this.outputs.set([]); }
  }
  private async port(): Promise<MIDIOutput | null> {
    if (this.output() === 'sf' || this.output() === 'bbcso') return null;
    await this.refreshOutputs();
    const p = this.midiAccess?.outputs.get(this.output()) ?? null;
    if (!p) this.msg.set('La porta MIDI scelta non c\'è (loopMIDI è avviato?): suono con il soundfont interno.');
    return p;
  }
  async setOutput(id: string) {
    this.halt();
    this.output.set(id); lsSet('.output', id);
    this.player?.pause(); this.player = null; this.loadedMid = '';
    if (id === 'bbcso') this.msg.set('BBCSO: ogni strumento esce sulla sua porta loopMIDI («SA Violin I», «SA Flute»…) verso Cubase, con i key switch delle expression map.');
    else if (id !== 'sf') this.msg.set('Uscita MIDI: ogni parte esce sul suo canale. Komplete Kontrol suona un solo strumento: per l\'orchestra usa l\'uscita BBCSO.');
    else this.msg.set('');
  }
  async chooseSoundfont(reset = false) {
    if (isDemo) return;
    const ok = await api.pickSoundfont(reset);
    if (!ok) return;
    this.halt(); this.loadedMid = ''; this.bank.set(''); this.player = null;
    await ScoreEngine.reset();
    this.msg.set(reset ? 'Torno al soundfont incluso: si carica al prossimo ascolto.' : 'Soundfont scelto: si carica al prossimo ascolto.');
  }

  // ---------- altezza del pannello ----------
  startResize(e: PointerEvent) {
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = this.effHeight();
    const max = Math.max(240, this.winH() - 420);
    const move = (ev: PointerEvent) => this.height.set(Math.round(Math.min(max, Math.max(240, h0 + ev.clientY - y0))));
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); lsSet('.height', String(this.height())); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  }
  resizeKey(e: KeyboardEvent) {
    const d = e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0;
    if (!d) return;
    e.preventDefault();
    this.height.set(Math.max(240, Math.min(this.winH() - 420, this.effHeight() + d)));
    lsSet('.height', String(this.height()));
  }
  resetHeight() { this.height.set(0); lsSet('.height', '0'); }

  onKey(e: KeyboardEvent) {
    if (e.key === ' ' && !(e.target as HTMLElement).closest('select,input,textarea')) { e.preventDefault(); void this.togglePlay(); }
  }
}
