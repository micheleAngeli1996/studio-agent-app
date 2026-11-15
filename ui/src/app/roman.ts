// Da numeri romani ad accordi con l'ortografia corretta (lettera + alterazione), in una tonalità data.
// Sintassi dei gradi:
//   I ii iii IV V vi viio  (maiuscolo = maggiore, minuscolo = minore), alterazione davanti: bVI  #iv
//   Suffissi: 7 maj7 9 o (diminuito) o7 (7ª diminuita) ø7 (semidiminuito) + (aumentato) sus4 7sus4
//   Rivolti (numerica): 6 (1° rivolto), 64 (2°), 65 43 42 (rivolti delle settime)
//   Dominanti secondarie: V7/V  viio7/ii  V7/IV ...
//   Speciali: N6 (sesta napoletana), It6 Fr6 Ger6 (seste aumentate), Cad64 (6/4 cadenzale)
//   Pedale: suffisso @1 (pedale di tonica) o @5 (pedale di dominante) → basso fisso
//   Cambio di tonalità: [V] [vi] [bIII] [i] ...  da quel punto i gradi si leggono nella nuova tonalità

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAT = [0, 2, 4, 5, 7, 9, 11];
const MAJ_STEPS = [0, 2, 4, 5, 7, 9, 11];
const MIN_STEPS = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export interface Tonality { letter: number; pc: number; minor: boolean; }
interface Note { letter: number; pc: number; }

export function noteName(n: Note): string {
  let d = ((n.pc - NAT[n.letter]) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return LETTERS[n.letter] + (d > 0 ? '#'.repeat(d) : 'b'.repeat(-d));
}

export function tonalityFromText(text: string): Tonality | null {
  const m = (text || '').trim().match(/^([A-Ga-g])([#b]?)\s*(m(?!aj)|min|minor|minore)?/);
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1].toUpperCase());
  const pc = (NAT[letter] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { letter, pc, minor: !!m[3] };
}

export function tonalityLabel(t: Tonality): string {
  return noteName({ letter: t.letter, pc: t.pc }) + (t.minor ? ' minor' : ' major');
}

/** Nota del grado (0-6) nella tonalità; in minore il VII che sale alla tonica è la sensibile alzata. */
function degree(t: Tonality, deg: number, acc = 0, raisedLeading = false): Note {
  const steps = t.minor ? MIN_STEPS : MAJ_STEPS;
  let semis = steps[deg];
  if (t.minor && deg === 6 && raisedLeading) semis = 11;
  return { letter: (t.letter + deg) % 7, pc: (t.pc + semis + acc + 120) % 12 };
}

function above(root: Note, steps: number, semis: number): Note {
  return { letter: (root.letter + steps) % 7, pc: (root.pc + semis) % 12 };
}

interface Parsed { acc: number; deg: number; upper: boolean; quality: string; figure: string; target?: string; pedal?: string; }

const TOKEN = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(o7|ø7|o|\+|maj7|7sus4|sus4|9|7)?(65|64|43|42|6)?(?:\/((?:b|#)?(?:VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)))?(@1|@5)?$/;

function parse(tok: string): Parsed | null {
  const m = tok.match(TOKEN);
  if (!m) return null;
  let quality = m[3] || '';
  // Numerica di settima (65, 43, 42) su un accordo senza 7ª esplicita: la 7ª è implicita
  if (/^(65|43|42)$/.test(m[4] || '')) quality = quality === '' ? '7' : quality === 'o' ? 'ø7' : quality;
  return { acc: m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0, deg: ROMAN.indexOf(m[2].toUpperCase()), upper: m[2] === m[2].toUpperCase(),
    quality, figure: m[4] || '', target: m[5], pedal: m[6] };
}

/** Tonicizzazione: tonalità temporanea sul grado indicato (per V7/V, viio7/ii...). */
function localKey(t: Tonality, numeral: string): Tonality {
  const p = parse(numeral)!;
  const root = degree(t, p.deg, p.acc, false);
  return { letter: root.letter, pc: root.pc, minor: !p.upper };
}

interface Built { root: Note; tones: Note[]; symbol: string; }

function build(t: Tonality, p: Parsed): Built {
  // Accordi sul V e sul VII in minore usano la sensibile alzata; V maiuscolo è sempre maggiore.
  const leading = p.deg === 6 && (!p.upper || p.quality.startsWith('o') || p.quality.startsWith('ø'));
  const root = degree(t, p.deg, p.acc, t.minor && leading);
  const third = above(root, 2, p.upper ? 4 : 3);
  let fifth = above(root, 4, 7);
  let symbol = '';
  const q = p.quality;
  const tones: Note[] = [root];
  if (q === 'o' || q === 'o7' || q === 'ø7') {
    fifth = above(root, 4, 6);
    tones.push(above(root, 2, 3), fifth);
    if (q === 'o7') { tones.push(above(root, 6, 9)); symbol = 'dim7'; } else if (q === 'ø7') { tones.push(above(root, 6, 10)); symbol = 'm7b5'; } else symbol = 'dim';
  } else if (q === '+') {
    tones.push(third, above(root, 4, 8)); symbol = 'aug';
  } else if (q === 'sus4' || q === '7sus4') {
    tones.push(above(root, 3, 5), fifth);
    if (q === '7sus4') { tones.push(above(root, 6, 10)); symbol = '7sus4'; } else symbol = 'sus4';
  } else {
    tones.push(third, fifth);
    if (q === '7') { tones.push(above(root, 6, 10)); symbol = p.upper ? '7' : 'm7'; }
    else if (q === 'maj7') { tones.push(above(root, 6, 11)); symbol = p.upper ? 'maj7' : 'mmaj7'; }
    else if (q === '9') { tones.push(above(root, 6, 10), above(root, 1, 14)); symbol = p.upper ? '9' : 'm9'; }
    else symbol = p.upper ? '' : 'm';
  }
  return { root, tones, symbol };
}

function withBass(b: Built, bassNote: Note | null): string {
  const name = noteName(b.root) + b.symbol;
  if (!bassNote || bassNote.pc === b.root.pc) return name;
  return `${name}/${noteName(bassNote)}`;
}

/** Grafia leggibile: ° e ø, numerica in apice/pedice, pedale per esteso. */
function pretty(l: string): string {
  return l.replace(/o(?=65|43|42)/g, 'ø').replace(/([iIvV])o(?=7|\d|$|\/|@)/g, '$1°')
    .replace(/65/, '⁶₅').replace(/64/, '⁶₄').replace(/43/, '⁴₃').replace(/42/, '⁴₂').replace(/([iIvV°ø+7])6(?![54])/, '$1⁶')
    .replace(/@1/, ' ped. I').replace(/@5/, ' ped. V');
}

export interface Realized { chord: string; numeral: string; key: string; keyChange?: string; }

/** Traduce una sequenza di gradi in accordi nella tonalità data. */
export function realize(template: string, home: Tonality): Realized[] {
  let t = home;
  let pendingChange: string | undefined;
  const out: Realized[] = [];
  for (const tok of template.split(/\s+/).filter(Boolean)) {
    const km = tok.match(/^\[(.+)\]$/);
    if (km) {
      const p = parse(km[1]);
      if (!p) throw new Error(`Cambio di tonalità non valido: ${tok}`);
      const root = degree(t, p.deg, p.acc, false);
      t = { letter: root.letter, pc: root.pc, minor: !p.upper };
      pendingChange = tonalityLabel(t);
      continue;
    }
    let b: Built;
    let bass: Note | null = null;
    let label = tok;
    if (tok === 'N6') {
      const root = degree(t, 1, t.minor ? 0 : -1);                 // II abbassato
      const r = { letter: root.letter, pc: t.minor ? (t.pc + 1) % 12 : (t.pc + 1) % 12 };
      b = { root: r, tones: [r, above(r, 2, 4), above(r, 4, 7)], symbol: '' };
      bass = above(r, 2, 4);
      label = 'N6';
    } else if (/^(It6|Fr6|Ger6)$/.test(tok)) {
      // Seste aumentate sul VI abbassato: suonano come un accordo di 7ª (Ger), 7ª con 5ª diminuita (Fr), 7ª senza 5ª (It)
      const r = { letter: (t.letter + 5) % 7, pc: (t.pc + 8) % 12 };
      const sym = tok === 'Fr6' ? '7b5' : '7';
      b = { root: r, tones: [r], symbol: sym };
      label = tok.replace('6', '+6');
    } else if (tok === 'Cad64') {
      const p = parse(t.minor ? 'i64' : 'I64')!;
      b = build(t, p);
      bass = b.tones[2];
      label = t.minor ? 'i⁶₄ cad.' : 'I⁶₄ cad.';
    } else {
      const p = parse(tok);
      if (!p) throw new Error(`Grado non riconosciuto: ${tok}`);
      const kk = p.target ? localKey(t, p.target) : t;
      b = build(kk, p.target ? { ...p, acc: 0 } : p);
      const fig = p.figure;
      if (fig === '6' || fig === '65') bass = b.tones[1];
      else if (fig === '64' || fig === '43') bass = b.tones[2];
      else if (fig === '42') bass = b.tones[3] ?? null;
      if (p.pedal) bass = degree(t, p.pedal === '@1' ? 0 : 4);
    }
    out.push({ chord: withBass(b, bass), numeral: pretty(label),
      key: tonalityLabel(t), keyChange: pendingChange });
    pendingChange = undefined;
  }
  return out;
}
