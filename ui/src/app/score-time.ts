// Partitura integrata: lettura minima di un file MIDI (tempo, parti) e abbinamento dei file della cartella score/.
import type { SongFile } from './api';

export interface MidiPart { name: string; channel: number; program: number; notes: number; }
export interface MidiInfo { tpq: number; tempos: { tick: number; us: number; sec: number }[]; parts: MidiPart[]; endTick: number; }
export interface ScorePair {
  name: string; xml?: string; mid?: string; stamp?: string;
  /** Sorgente per tools/score.py e MIDI per BBCSO (tools/bbcso.py), con le date di modifica. */
  json?: string; bbcso?: string; jsonTime?: number; bbcsoTime?: number;
}

/** Legge dal MIDI la risoluzione, i cambi di tempo e, per ogni traccia, nome, canale e numero di note. */
export function readMidi(buf: Uint8Array): MidiInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o: number, n: number) => String.fromCharCode(...buf.subarray(o, o + n));
  if (str(0, 4) !== 'MThd') throw new Error('Non è un file MIDI');
  const tpq = dv.getUint16(12) & 0x7fff || 480;
  const tempos: { tick: number; us: number }[] = [];
  const parts: MidiPart[] = [];
  let o = 8 + dv.getUint32(4), endTick = 0;
  const dec = new TextDecoder();
  while (o + 8 <= buf.length) {
    const len = dv.getUint32(o + 4), start = o + 8, end = Math.min(buf.length, start + len);
    if (str(o, 4) !== 'MTrk') { o = end; continue; }
    let p = start, tick = 0, run = 0, name = '', channel = -1, program = -1, notes = 0;
    const vlq = () => { let v = 0, b; do { b = buf[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && p < end); return v; };
    while (p < end) {
      tick += vlq();
      let st = buf[p];
      if (st & 0x80) p++; else st = run;
      if (st === 0xff) {
        const type = buf[p++], l = vlq();
        if (type === 0x51 && l === 3) tempos.push({ tick, us: (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2] });
        if (type === 0x03 && !name) name = dec.decode(buf.subarray(p, p + l)).trim();
        p += l;
      } else if (st === 0xf0 || st === 0xf7) { p += vlq(); }
      else {
        run = st;
        const kind = st & 0xf0, ch = st & 0x0f;
        const d1 = buf[p], d2 = buf[p + 1];
        p += kind === 0xc0 || kind === 0xd0 ? 1 : 2;
        if (kind === 0x90 && d2 > 0) { notes++; if (channel < 0) channel = ch; }
        if (kind === 0xc0 && program < 0) { program = d1; if (channel < 0) channel = ch; }
      }
    }
    endTick = Math.max(endTick, tick);
    if (notes) parts.push({ name: name || `Canale ${channel + 1}`, channel, program, notes });
    o = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, us: 500000 });
  let sec = 0;
  const out = tempos.map((t, i) => {
    if (i) sec += ((t.tick - tempos[i - 1].tick) / tpq) * (tempos[i - 1].us / 1e6);
    return { ...t, sec };
  });
  return { tpq, tempos: out, parts, endTick };
}

/** Secondi dall'inizio → quarti dall'inizio, seguendo i cambi di tempo. */
export function secToQuarters(m: MidiInfo, sec: number): number {
  let t = m.tempos[0];
  for (const x of m.tempos) { if (x.sec <= sec) t = x; else break; }
  return t.tick / m.tpq + (sec - t.sec) / (t.us / 1e6);
}
/** Quarti dall'inizio → secondi (per saltare a una battuta). */
export function quartersToSec(m: MidiInfo, q: number): number {
  let t = m.tempos[0];
  for (const x of m.tempos) { if (x.tick / m.tpq <= q) t = x; else break; }
  return t.sec + (q - t.tick / m.tpq) * (t.us / 1e6);
}

/** Indice dell'ultimo passo del cursore che inizia entro «q» quarti (passi ordinati). */
export function stepAt(steps: number[], q: number): number {
  let lo = 0, hi = steps.length - 1, r = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (steps[mid] <= q + 1e-6) { r = mid; lo = mid + 1; } else hi = mid - 1; }
  return r;
}

/** Abbina, nella cartella score/, ogni MusicXML al MIDI con lo stesso nome; anche MIDI senza partitura. */
export function pairScores(files: SongFile[]): ScorePair[] {
  const map = new Map<string, ScorePair>();
  for (const f of files) {
    if (f.kind !== 'score') continue;
    const m = f.name.match(/^(.*?)(\.bbcso)?\.(musicxml|xml|mid|midi|json)$/i);
    if (!m) continue;
    const p = map.get(m[1]) ?? { name: m[1] };
    const ext = m[3].toLowerCase();
    if (m[2]) { if (ext.startsWith('mid')) { p.bbcso = f.path; p.bbcsoTime = f.mtime; } }
    else if (ext === 'json') { p.json = f.path; p.jsonTime = f.mtime; }
    else {
      if (ext.startsWith('mid')) p.mid = f.path; else p.xml = f.path;
      if (f.mtime) p.stamp = (p.stamp ? p.stamp + '/' : '') + f.mtime;
    }
    map.set(m[1], p);
  }
  for (const [k, p] of map) if (!p.xml && !p.mid) map.delete(k);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
