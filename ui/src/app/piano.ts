// Pianoforte sintetizzato con Web Audio: nessun campione da scaricare, condotta delle parti automatica.
import { ChordTones } from './harmony';

export type Style = 'block' | 'arp';
export interface PlayOptions { bpm: number; style: Style; loop: boolean; }
/** Nota di un arrangiamento: [inizio in tempi, durata in tempi, nota MIDI, velocity 1-127, canale 0-15]. */
export type NoteEvent = [number, number, number, number, number];
export type CcEvent = [number, number, number, number];
/** 'separate': Piano 1, Electric Bass 2, melodia 3, Drums 10.  'single': tutto sul canale 1, senza batteria. */
export type ChannelMode = 'separate' | 'single';

/** Disposizione: basso nell'ottava 2–3, tre/quattro voci superiori tra G3 e G5 con il minimo movimento. */
export function voiceLead(chords: ChordTones[]): { bass: number; upper: number[] }[] {
  const out: { bass: number; upper: number[] }[] = [];
  let prevBass = 43;
  let prev: number[] | null = null;
  for (const c of chords) {
    let pcs = c.intervals.map((i) => (c.root + i) % 12);
    if (pcs.length >= 5) pcs = pcs.filter((_, i) => c.intervals[i] !== 7);         // nelle none si omette la 5ª
    let upperPcs = pcs.length >= 4 ? pcs.filter((p) => p !== c.bass) : pcs;        // nelle settime non raddoppiare il basso
    if (upperPcs.length === 0) upperPcs = pcs;
    upperPcs = [...new Set(upperPcs)];
    // basso: l'ottava più vicina al basso precedente, tra C2 e E3
    let bass = 36 + c.bass;
    if (bass > 52) bass -= 12;
    if (Math.abs(bass + 12 - prevBass) < Math.abs(bass - prevBass) && bass + 12 <= 52) bass += 12;
    if (Math.abs(bass - 12 - prevBass) < Math.abs(bass - prevBass) && bass - 12 >= 36) bass -= 12;
    // voci superiori: tutte le combinazioni di ottava nell'ambito, scelta a costo minimo
    const options = upperPcs.map((p) => [55, 67, 79].map((o) => o + ((p - o % 12 + 12) % 12)).filter((n) => n >= 55 && n <= 79));
    let best: number[] = [];
    let bestCost = Infinity;
    const rec = (i: number, acc: number[]) => {
      if (i === options.length) {
        const v = [...acc].sort((a, b) => a - b);
        const spread = v[v.length - 1] - v[0];
        if (spread > 15 || v[0] <= bass + 2) return;
        let cost: number;
        if (prev && prev.length === v.length) cost = v.reduce((s, n, k) => s + Math.abs(n - prev![k]), 0);
        else { const center = prev ? prev.reduce((a, b) => a + b, 0) / prev.length : 66; cost = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - center) * v.length; }
        cost += spread * 0.15 + Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 66) * 0.25; // posizioni strette, registro centrale
        if (cost < bestCost) { bestCost = cost; best = v; }
        return;
      }
      for (const n of options[i]) rec(i + 1, [...acc, n]);
    };
    rec(0, []);
    if (!best.length) best = upperPcs.map((p) => 60 + p).sort((a, b) => a - b);
    out.push({ bass, upper: best });
    prev = best;
    prevBass = bass;
  }
  return out;
}

export class Piano {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private wave!: PeriodicWave;
  private voices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private timers: number[] = [];
  private session = 0;

  private init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    // riverbero corto generato (rumore con decadimento esponenziale)
    const len = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.16;
    this.out = ctx.createGain();
    this.out.connect(master);
    this.out.connect(verb); verb.connect(wet); wet.connect(master);
    master.connect(comp); comp.connect(ctx.destination);
    // timbro: armoniche con ampiezza decrescente (corda percossa, il martelletto attenua le armoniche pari alte)
    const n = 12;
    const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = (1 / Math.pow(k, 1.6)) * (k % 7 === 0 ? 0.2 : 1);
    this.wave = ctx.createPeriodicWave(real, imag);
  }

  // ---------- uscita MIDI (Komplete Kontrol o altri strumenti) ----------
  private midi: MIDIOutput | null = null;
  private sent: { note: number; on: number; ch: number }[] = [];
  channelMode: ChannelMode = 'single';
  /** Pedale di risonanza (CC64) al cambio di accordo, quando si suona via MIDI. */
  pedal = true;
  setMidiOutput(o: MIDIOutput | null) { this.stop(); this.midi = o; }
  get usingMidi() { return !!this.midi; }

  private note(midi: number, when: number, dur: number, vel: number, ch = 0) {
    if (this.midi) {
      if (this.channelMode === 'single') { if (ch === 9) return; ch = 0; }
      return this.midiNote(midi, when, dur, vel, ch);
    }
    if (ch === 9) return this.drum(midi, when, vel);
    const ctx = this.ctx!;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(16000, f * (3 + vel * 9)), when);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 400), when + 1.2);  // il suono si scurisce mentre decade
    const oscs = [0, 4].map((cents) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(this.wave);
      o.frequency.value = f;
      o.detune.value = cents * (midi > 60 ? 1 : 0.5);                                  // leggero battimento tra corde
      o.connect(lp);
      return o;
    });
    lp.connect(gain);
    gain.connect(this.out);
    const peak = 0.16 * vel * (midi < 48 ? 1.25 : 1);
    const decay = 0.6 + (96 - midi) / 30;                                              // note gravi più lunghe
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.006);
    gain.gain.setTargetAtTime(peak * 0.25, when + 0.006, decay * 0.35);
    const end = when + dur;
    gain.gain.setTargetAtTime(0, end, 0.12);
    oscs.forEach((o) => { o.start(when); o.stop(end + 0.8); });
    const v = { osc: oscs, gain };
    this.voices.push(v);
    oscs[0].onended = () => { this.voices = this.voices.filter((x) => x !== v); gain.disconnect(); };
  }

  /** Nota MIDI sul canale 1, con il tempo dell'orologio audio convertito in quello di performance.now(). */
  private midiNote(n: number, when: number, dur: number, vel: number, ch = 0) {
    const delay = Math.max(0, when - this.ctx!.currentTime) * 1000;
    if (delay > 150) {                 // note lontane (arpeggi): programmate con un timer, che «Ferma» annulla
      this.timers.push(window.setTimeout(() => this.midi && this.midiNote(n, this.ctx!.currentTime + 0.05, dur, vel, ch), delay - 50));
      return;
    }
    const on = performance.now() + delay;
    const v = Math.max(1, Math.min(127, Math.round(vel * 127)));
    this.midi!.send([0x90 | ch, n, v], on);
    this.midi!.send([0x80 | ch, n, 0], on + dur * 1000);
    this.sent.push({ note: n, on, ch });
    const now = performance.now();
    this.sent = this.sent.filter((x) => x.on > now - 20000);
  }

  /** Control change via MIDI (es. CC64 pedale) all'istante «when» dell'orologio audio. */
  private cc(ctl: number, val: number, when: number, ch = 0) {
    if (!this.midi) return;
    if (this.channelMode === 'single') { if (ch === 9) return; ch = 0; }
    const delay = Math.max(0, when - this.ctx!.currentTime) * 1000;
    if (delay > 150) { this.timers.push(window.setTimeout(() => this.cc(ctl, val, this.ctx!.currentTime + 0.05, ch), delay - 50)); return; }
    this.midi.send([0xB0 | ch, ctl, val], performance.now() + delay);
  }

  /** Batteria sintetizzata per il pianoforte interno (cassa, rullante, charleston, piatti). */
  private drum(n: number, when: number, vel: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.connect(this.out);
    const amp = 0.5 * vel;
    if (n === 35 || n === 36) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(140, when);
      o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
      g.gain.setValueAtTime(amp, when);
      g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
      o.connect(g); o.start(when); o.stop(when + 0.35);
      return;
    }
    const long = n === 49 || n === 57 || n === 51 || n === 46;
    const len = long ? (n === 51 ? 0.6 : 1.4) : n === 42 ? 0.06 : n === 37 ? 0.05 : 0.18;
    const buf = this.noise ?? (this.noise = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    if (n === 38 || n === 40) { f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7; }
    else if (n === 37) { f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 4; }
    else { f.type = 'highpass'; f.frequency.value = n === 51 ? 5000 : 7000; }
    src.connect(f); f.connect(g);
    g.gain.setValueAtTime(amp * (n === 42 ? 0.5 : long ? 0.35 : 0.9), when);
    g.gain.exponentialRampToValueAtTime(0.001, when + len);
    src.start(when); src.stop(when + len + 0.05);
    if (n === 38 || n === 40) {                       // corpo del rullante
      const o = ctx.createOscillator(); const og = ctx.createGain();
      o.frequency.value = 190; og.gain.setValueAtTime(amp * 0.5, when); og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
      o.connect(og); og.connect(this.out); o.start(when); o.stop(when + 0.12);
    }
  }
  private noise: AudioBuffer | null = null;

  /** Nota di prova (C4) per verificare l'uscita scelta. */
  testNote() {
    this.init();
    const t = this.ctx!.currentTime + 0.03;
    [48, 60, 64, 67].forEach((n, i) => this.note(n, t + i * 0.12, 1.2, 0.7));
  }

  /** Suona un arrangiamento già calcolato (tools/arrange.py), programmando le note a blocchi di 0,4 s.
   *  onPos riceve la posizione in tempi; -1 alla fine. */
  playEvents(notes: NoteEvent[], ccs: CcEvent[], bpm: number, onPos: (beat: number) => void) {
    this.stop();
    if (!notes.length) return;
    this.init();
    const session = ++this.session;
    const spb = 60 / Math.max(30, Math.min(240, bpm || 90));
    const t0 = this.ctx!.currentTime + 0.1;
    const evs = [...notes].sort((a, b) => a[0] - b[0]);
    const cs = [...ccs].sort((a, b) => a[0] - b[0]);
    const end = Math.max(...evs.map((e) => e[0] + e[1]));
    let i = 0, j = 0;
    const tick = () => {
      if (session !== this.session) return;
      const horizon = this.ctx!.currentTime + 0.4;
      while (i < evs.length && t0 + evs[i][0] * spb < horizon) {
        const [t, d, n, v, ch] = evs[i++];
        this.note(n, t0 + t * spb, d * spb, v / 127, ch);
      }
      while (j < cs.length && t0 + cs[j][0] * spb < horizon) {
        const [t, ctl, val, ch] = cs[j++];
        this.cc(ctl, val, t0 + t * spb, ch);
      }
      const pos = (this.ctx!.currentTime - t0) / spb;
      onPos(Math.max(0, pos));
      if (pos > end + 0.5) { onPos(-1); return; }
      this.timers.push(window.setTimeout(tick, 120));
    };
    tick();
  }

  /** Suona un accordo singolo (anteprima al clic). */
  chord(c: ChordTones, prev?: ChordTones) {
    this.init();
    const vl = voiceLead(prev ? [prev, c] : [c]);
    const v = vl[vl.length - 1];
    const t = this.ctx!.currentTime + 0.03;
    this.note(v.bass, t, 1.6, 0.8);
    v.upper.forEach((n, i) => this.note(n, t + i * 0.008, 1.6, 0.62));
  }

  /** Suona la progressione; onStep riceve l'indice dell'accordo che sta suonando, -1 alla fine.
   *  Ogni accordo viene programmato poco prima che suoni, così «Ferma» non lascia note in coda. */
  play(chords: ChordTones[], opt: PlayOptions, onStep: (i: number) => void) {
    this.stop();
    if (!chords.length) return;
    this.init();
    const session = ++this.session;
    const beat = 60 / Math.max(30, Math.min(240, opt.bpm || 90));
    const vl = voiceLead(chords);
    const ahead = 0.12;
    const schedule = (i: number, t: number) => {
      if (session !== this.session) return;
      if (i === chords.length) {
        const wait = (t - this.ctx!.currentTime) * 1000;
        this.timers.push(window.setTimeout(() => {
          if (session !== this.session) return;
          if (opt.loop) schedule(0, this.ctx!.currentTime + 0.05); else onStep(-1);
        }, Math.max(0, wait - 20)));
        return;
      }
      const c = chords[i], v = vl[i], len = c.beats * beat;
      if (this.midi && this.pedal) { this.cc(64, 0, t - 0.01); this.cc(64, 127, t + 0.03); }
      const accent = (k: number) => 0.58 + (Math.random() - 0.5) * 0.06 + (k === v.upper.length - 1 ? 0.04 : 0);
      if (opt.style === 'block') {
        this.note(v.bass, t, len * 0.96, 0.78);
        v.upper.forEach((n, k) => this.note(n, t + k * 0.01, len * 0.94, accent(k)));
      } else {
        // arpeggio in crome: basso, poi le voci superiori su e giù
        const seq = [...v.upper, ...v.upper.slice(1, -1).reverse()];
        const steps = Math.max(1, Math.round(c.beats * 2));
        this.note(v.bass, t, len * 0.98, 0.78);
        for (let s = 1; s < steps; s++) this.note(seq[(s - 1) % seq.length], t + s * beat / 2, Math.min(len - s * beat / 2, beat * 1.5), 0.5);
      }
      this.timers.push(window.setTimeout(() => session === this.session && onStep(i), Math.max(0, (t - this.ctx!.currentTime) * 1000)));
      const next = t + len;
      this.timers.push(window.setTimeout(() => schedule(i + 1, next), Math.max(0, (next - ahead - this.ctx!.currentTime) * 1000)));
    };
    schedule(0, this.ctx!.currentTime + 0.08);
  }

  /** Suona voci già scritte (basso, tenore, alto, soprano): un accordo ogni due tempi. */
  playVoices(parts: number[][], bpm: number, onStep: (i: number) => void) {
    this.stop();
    this.init();
    const session = ++this.session;
    const len = 2 * 60 / Math.max(30, Math.min(240, bpm || 80));
    const n = parts[0].length;
    const step = (i: number, t: number) => {
      if (session !== this.session) return;
      if (i === n) { this.timers.push(window.setTimeout(() => session === this.session && onStep(-1), Math.max(0, (t - this.ctx!.currentTime) * 1000))); return; }
      parts.forEach((p, k) => this.note(p[i], t, len * 0.95, k === 0 ? 0.72 : 0.6));
      this.timers.push(window.setTimeout(() => session === this.session && onStep(i), Math.max(0, (t - this.ctx!.currentTime) * 1000)));
      this.timers.push(window.setTimeout(() => step(i + 1, t + len), Math.max(0, (t + len - 0.12 - this.ctx!.currentTime) * 1000)));
    };
    step(0, this.ctx!.currentTime + 0.08);
  }

  stop() {
    this.session++;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    if (this.midi) {
      // note-off subito per le note suonate e di nuovo all'istante previsto per quelle già in coda
      const now = performance.now();
      for (const x of this.sent) { this.midi.send([0x80 | x.ch, x.note, 0]); if (x.on > now) this.midi.send([0x80 | x.ch, x.note, 0], x.on + 2); }
      for (const ch of new Set([0, ...this.sent.map((x) => x.ch)])) { this.midi.send([0xB0 | ch, 64, 0]); this.midi.send([0xB0 | ch, 123, 0]); }
      this.sent = [];
    }
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.05);
      v.osc.forEach((o) => { try { o.stop(now + 0.3); } catch { /* già fermato */ } });
    }
  }
}
