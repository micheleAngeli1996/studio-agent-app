// Analisi leggera di una progressione: accordi, durate e gradi rispetto alla tonalità indicata.
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = ['', 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'm7b5', 'aug', 'sus4', 'sus2', '6', 'm6', '9', 'add9', 'm9', 'mmaj7'];
const CH = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?(?::(\d+(?:\.\d+)?))?$/;
const MAJ: Record<number, string> = { 0: 'I', 2: 'II', 4: 'III', 5: 'IV', 7: 'V', 9: 'VI', 11: 'VII' };
const MIN: Record<number, string> = { 0: 'I', 2: 'II', 3: 'III', 5: 'IV', 7: 'V', 8: 'VI', 10: 'VII', 11: 'VII' };
const CHROM: Record<number, string> = { 1: '♭II', 3: '♭III', 6: '♯IV', 8: '♭VI', 10: '♭VII' };

export interface Cell { name: string; beats: number; numeral: string; ok: boolean; bar: number; }
export interface Key { tonic: number; minor: boolean; label: string; }

function pc(l: string, a: string) { return (NOTE[l] + (a === '#' ? 1 : a === 'b' ? -1 : 0) + 12) % 12; }

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
