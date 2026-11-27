// Partitura integrata: ascolto con BBC Symphony Orchestra in Cubase. Il file <nome>.bbcso.mid (tools/bbcso.py)
// ha una traccia per parte con la sua porta loopMIDI (meta «device name», es. «SA Violin I») e i key switch delle
// expression map già al loro posto: qui le tracce si suonano in tempo reale, ognuna sulla sua porta.
import { MidiInfo, quartersToSec, readMidi } from './score-time';

export interface Player {
  play(): Promise<void>;
  pause(): void;
  finish(): void;
  readonly paused: boolean;
  time: number;
  readonly duration: number;
  setRate(r: number): void;
  setMuted(channels: number[], names: string[]): void;
}

export interface PortTrack { name: string; port: string; keyswitches: number[]; events: { t: number; data: number[] }[]; }

/** Tracce del MIDI con porta, key switch dichiarati ed eventi di canale in secondi. */
export function readPortTracks(buf: Uint8Array, info: MidiInfo = readMidi(buf)): PortTrack[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const out: PortTrack[] = [];
  let o = 8 + dv.getUint32(4);
  while (o + 8 <= buf.length) {
    const len = dv.getUint32(o + 4), start = o + 8, end = Math.min(buf.length, start + len);
    const isTrack = String.fromCharCode(...buf.subarray(o, o + 4)) === 'MTrk';
    o = end;
    if (!isTrack) continue;
    let p = start, tick = 0, run = 0;
    const tr: PortTrack = { name: '', port: '', keyswitches: [], events: [] };
    const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let st = buf[p];
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const type = buf[p++], l = vlq(), txt = () => dec.decode(buf.subarray(p, p + l)).trim();
        if (type === 0x03 && !tr.name) tr.name = txt();
        if (type === 0x09 || type === 0x04) tr.port ||= txt();
        if (type === 0x01) { const m = txt().match(/^keyswitches:([\d,]+)/); if (m) tr.keyswitches = m[1].split(',').map(Number); }
        p += l;
      } else if (st === 0xf0 || st === 0xf7) { p += vlq(); }
      else {
        run = st;
        const n = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2;
        tr.events.push({ t: quartersToSec(info, tick / info.tpq), data: [st, ...buf.subarray(p, p + n)] });
        p += n;
      }
    }
    if (tr.events.length) out.push(tr);
  }
  return out;
}

/** Stato da ripristinare partendo a metà: ultimo valore di ogni controller e ultimo key switch prima di «t». */
export function chase(tr: PortTrack, t: number): number[][] {
  const cc = new Map<string, number[]>();
  let ks: number[] | null = null;
  for (const e of tr.events) {
    if (e.t >= t) break;
    const [st, d1] = e.data;
    if ((st & 0xf0) === 0xb0) cc.set(`${st}:${d1}`, e.data);
    if ((st & 0xf0) === 0x90 && e.data[2] > 0 && tr.keyswitches.includes(d1)) ks = e.data;
  }
  const out = [...cc.values()];
  if (ks) out.push(ks, [0x80 | (ks[0] & 0x0f), ks[1], 0]);
  return out;
}

export class PortPlayer implements Player {
  readonly tracks: PortTrack[];
  readonly duration: number;
  private outs = new Map<string, MIDIOutput>();
  private from = 0;
  private t0 = 0;
  private rate = 1;
  private idx: number[] = [];
  private timer = 0;
  private muted = new Set<string>();
  private sounding = new Map<string, Set<string>>();   // porta → "canale:nota" che suonano
  paused = true;

  constructor(buf: Uint8Array, private access: MIDIAccess) {
    const info = readMidi(buf);
    this.tracks = readPortTracks(buf, info);
    this.duration = Math.max(0, ...this.tracks.map((t) => t.events.at(-1)?.t ?? 0));
    this.resolve();
  }

  /** Porte che servono e che non ci sono (loopMIDI). */
  resolve(): string[] {
    const byName = new Map([...this.access.outputs.values()].map((o) => [(o.name ?? '').trim().toLowerCase(), o]));
    const missing: string[] = [];
    this.outs.clear();
    for (const tr of this.tracks) {
      const o = byName.get(tr.port.toLowerCase());
      if (o) this.outs.set(tr.port, o); else if (!missing.includes(tr.port)) missing.push(tr.port);
    }
    return missing;
  }

  get time() { return this.paused ? this.from : this.from + ((performance.now() - this.t0) / 1000) * this.rate; }
  set time(t: number) {
    const was = !this.paused;
    if (was) this.stopAll();
    this.from = Math.max(0, Math.min(t, this.duration));
    if (was) void this.play();
  }
  setRate(r: number) { const t = this.time; this.rate = r; if (!this.paused) { this.from = t; this.t0 = performance.now(); } }
  setMuted(_ch: number[], names: string[]) {
    this.muted = new Set(names);
    if (!this.paused) for (const tr of this.tracks) if (this.muted.has(tr.name)) this.silence(tr.port);
  }

  async play() {
    this.paused = false;
    this.t0 = performance.now();
    this.idx = this.tracks.map((tr) => { const i = tr.events.findIndex((e) => e.t >= this.from); return i < 0 ? tr.events.length : i; });
    for (const tr of this.tracks) {
      const o = this.outs.get(tr.port);
      if (o && !this.muted.has(tr.name)) for (const d of chase(tr, this.from)) o.send(d);
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(), 25) as unknown as number;
    this.pump();
  }

  private pump() {
    const now = performance.now(), ahead = 120;
    this.tracks.forEach((tr, k) => {
      const o = this.outs.get(tr.port), evs = tr.events;
      let i = this.idx[k];
      while (i < evs.length) {
        const at = this.t0 + ((evs[i].t - this.from) / this.rate) * 1000;
        if (at > now + ahead) break;
        if (o && !this.muted.has(tr.name)) {
          const d = evs[i].data, kind = d[0] & 0xf0, key = `${d[0] & 0x0f}:${d[1]}`;
          o.send(d, Math.max(now, at));
          const s = this.sounding.get(tr.port) ?? new Set<string>();
          if (kind === 0x90 && d[2] > 0) s.add(key); else if (kind === 0x80 || kind === 0x90) s.delete(key);
          this.sounding.set(tr.port, s);
        }
        i++;
      }
      this.idx[k] = i;
    });
    if (this.time >= this.duration + 0.5) this.finish();
  }

  private silence(port: string, at = performance.now() + 150) {
    const o = this.outs.get(port);
    if (!o) return;
    for (const key of this.sounding.get(port) ?? []) { const [ch, n] = key.split(':').map(Number); o.send([0x80 | ch, n, 0], at); }
    for (let ch = 0; ch < 16; ch++) if ([...(this.sounding.get(port) ?? [])].some((k) => k.startsWith(ch + ':')) || ch === 0) {
      o.send([0xb0 | ch, 64, 0], at); o.send([0xb0 | ch, 123, 0], at);
    }
    this.sounding.set(port, new Set());
  }
  private stopAll() {
    clearInterval(this.timer); this.timer = 0;
    // i messaggi già messi in coda (fino a 120 ms) partono comunque: le note vengono spente subito dopo
    for (const port of new Set(this.tracks.map((t) => t.port))) this.silence(port);
  }
  pause() { if (this.paused) return; this.from = this.time; this.stopAll(); this.paused = true; }
  finish() { this.pause(); }
}
