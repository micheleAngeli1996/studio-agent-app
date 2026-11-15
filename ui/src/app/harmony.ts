// Analisi leggera di una progressione: accordi, durate e gradi rispetto alla tonalità indicata.
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const INTERVALS: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9], '9': [0, 4, 7, 10, 14],
  add9: [0, 4, 7, 14], m9: [0, 3, 7, 10, 14], mmaj7: [0, 3, 7, 11], '7b5': [0, 4, 6, 10], '7sus4': [0, 5, 7, 10],
};
const QUAL = Object.keys(INTERVALS);
const CH = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?(?::(\d+(?:\.\d+)?))?$/;
const MAJ: Record<number, string> = { 0: 'I', 2: 'II', 4: 'III', 5: 'IV', 7: 'V', 9: 'VI', 11: 'VII' };
const MIN: Record<number, string> = { 0: 'I', 2: 'II', 3: 'III', 5: 'IV', 7: 'V', 8: 'VI', 10: 'VII', 11: 'VII' };
const CHROM: Record<number, string> = { 1: '♭II', 3: '♭III', 6: '♯IV', 8: '♭VI', 10: '♭VII' };

export interface Cell { name: string; beats: number; numeral: string; ok: boolean; bar: number; }
export interface Key { tonic: number; minor: boolean; label: string; }

export function pc(l: string, a: string) { return (NOTE[l] + (a === '#' ? 1 : a === 'b' ? -1 : 0) + 12) % 12; }

export function parseKey(text: string): Key | null {
  const m = (text || '').trim().match(/^([A-Ga-g])([#b]?)\s*(m(?!aj)|min|minor|minore)?/);
  if (!m) return null;
  const minor = !!m[3];
  const name = m[1].toUpperCase() + m[2];
  return { tonic: pc(m[1].toUpperCase(), m[2]), minor, label: name + (minor ? 'm' : '') };
}

/** Tonalità in forma breve per prog2midi (Am, C, Eb). */
export function keyForMidi(text: string): string { return parseKey(text)?.label ?? ''; }

export function analyze(prog: string, keyText: string, beatsPerBar = 4): Cell[] {
  const key = parseKey(keyText);
  const cells: Cell[] = [];
  let t = 0;
  for (const tok of (prog || '').replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    const m = tok.match(CH);
    if (!m || !QUAL.includes(m[3])) { cells.push({ name: tok, beats: beatsPerBar, numeral: '?', ok: false, bar: Math.floor(t / beatsPerBar) + 1 }); t += beatsPerBar; continue; }
    const beats = m[6] ? parseFloat(m[6]) : beatsPerBar;
    let numeral = '';
    if (key) {
      const iv = (pc(m[1], m[2]) - key.tonic + 12) % 12;
      const base = (key.minor ? MIN : MAJ)[iv] ?? CHROM[iv] ?? '?';
      const q = m[3];
      const lower = /^m(?!aj)|dim|m7b5/.test(q);
      const suffix = q === 'dim' ? '°' : q === 'dim7' ? '°7' : q === 'm7b5' ? 'ø7' : q === 'aug' ? '+' : q === 'maj7' ? 'maj7'
        : q === '7' || q === 'm7' ? '7' : q === '9' || q === 'm9' ? '9' : q === '6' || q === 'm6' ? '6' : q.startsWith('sus') ? q : q === 'add9' ? 'add9' : '';
      numeral = (lower ? base.toLowerCase() : base) + suffix + (m[4] ? '/' + m[4] + (m[5] || '') : '');
    }
    cells.push({ name: tok.split(':')[0], beats, numeral, ok: true, bar: Math.floor(t / beatsPerBar) + 1 });
    t += beats;
  }
  return cells;
}

export const BOOKS = [
  { id: 'armonia1', label: 'De Ninno, Armonia vol. I' },
  { id: 'armonia2', label: 'De Ninno, Armonia vol. II' },
  { id: 'adler', label: 'Adler, The Study of Orchestration' },
];

export interface ChordTones { root: number; bass: number; intervals: number[]; beats: number; name: string; }

/** Note di un accordo scritto come simbolo (Am, G7/B, Bb:2): classi di altezza di fondamentale e basso, intervalli, durata. */
export function chordTones(tok: string, beatsPerBar = 4): ChordTones | null {
  const m = tok.match(CH);
  if (!m || !(m[3] in INTERVALS)) return null;
  const root = pc(m[1], m[2]);
  return { root, bass: m[4] ? pc(m[4], m[5]) : root, intervals: INTERVALS[m[3]], beats: m[6] ? parseFloat(m[6]) : beatsPerBar, name: tok.split(':')[0] };
}

export function parseProgression(prog: string, beatsPerBar = 4): ChordTones[] {
  return (prog || '').replace(/\|/g, ' ').split(/\s+/).filter(Boolean).map((t) => chordTones(t, beatsPerBar)).filter((x): x is ChordTones => !!x);
}

/** È una sequenza di accordi riproducibile? (almeno due simboli, tutti validi) */
export function isChordLine(text: string): boolean {
  const toks = text.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
  return toks.length >= 2 && toks.every((t) => !!chordTones(t));
}
