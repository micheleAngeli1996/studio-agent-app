// Motore dei suggerimenti di sviluppo armonico: modelli in numeri romani, realizzati nella tonalità del brano
// e ordinati secondo il tipo di composizione. I riferimenti di pagina rimandano al De Ninno (Fonte).
import { realize, tonalityFromText, tonalityLabel, Realized, Tonality } from './roman';

export const COMPOSITION_TYPES = [
  { id: 'song', label: 'Brano (pop/rock)' },
  { id: 'ballad', label: 'Ballata' },
  { id: 'symphony', label: 'Sinfonia / orchestrale' },
  { id: 'film', label: 'Colonna sonora' },
  { id: 'chorale', label: 'Corale / esercizio' },
  { id: 'jazz', label: 'Jazz' },
] as const;
export type CompositionType = typeof COMPOSITION_TYPES[number]['id'];

export function typeFromText(text: string): CompositionType {
  const t = (text || '').toLowerCase();
  const hit = COMPOSITION_TYPES.find(c => c.id === t || c.label.toLowerCase() === t || t.startsWith(c.label.toLowerCase().split(' ')[0]));
  return hit ? hit.id : 'song';
}

export type Technique = 'cadenza' | 'settime' | 'modulazione' | 'cromatismo' | 'colore';
export const TECHNIQUES: Record<Technique, string> = {
  cadenza: 'Cadenze', settime: 'Settime e risoluzioni', modulazione: 'Modulazioni', cromatismo: 'Alterazioni cromatiche', colore: 'Colore e tensione',
};

interface Ref { book: 'armonia1' | 'armonia2'; page: number; label: string; }
interface Model {
  id: string; title: string; technique: Technique;
  maj: string; min: string;               // modello per tonalità maggiore e minore
  how: string;                            // come funziona (condotta delle parti)
  weight: Partial<Record<CompositionType, number>>; // 0–3: quanto è idiomatico per il tipo
  ref?: Ref;
}

const MODELS: Model[] = [
  { id: 'deceptive', title: 'Cadenza evitata (d\'inganno)', technique: 'cadenza',
    maj: 'IV ii65 V7 vi', min: 'iv iio65 V7 VI',
    how: 'La 7ª del V scende, la sensibile sale alla tonica, ma il basso sale di grado al VI: in quel VI raddoppia la terza. L\'orecchio aspetta la tonica e riceve il relativo.',
    weight: { song: 3, ballad: 3, symphony: 3, film: 3, chorale: 3, jazz: 1 }, ref: { book: 'armonia1', page: 116, label: 'cadenza evitata' } },
  { id: 'deceptive-bvi', title: 'Cadenza evitata sul bVI', technique: 'cadenza',
    maj: 'ii65 V7 bVI IV Cad64 V7 I', min: 'iio65 V7 VI iv Cad64 V7 i',
    how: 'Variante "di prestito": il V7 sfocia sul VI abbassato (dal minore), poi la frase si riprende con 6/4 cadenzale e cadenza perfetta.',
    weight: { song: 2, ballad: 3, symphony: 2, film: 3, chorale: 1, jazz: 1 }, ref: { book: 'armonia1', page: 116, label: 'cadenza evitata' } },
  { id: 'cad64', title: 'Cadenza perfetta con 6/4 cadenzale', technique: 'cadenza',
    maj: 'I IV ii6 Cad64 V7 I', min: 'i iv iio6 Cad64 V7 i',
    how: 'Il 6/4 è un\'appoggiatura doppia sul V: la 6ª e la 4ª scendono a 5ª e 3ª mentre il basso tiene la dominante.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 1, chorale: 3, jazz: 0 }, ref: { book: 'armonia1', page: 109, label: 'cadenze' } },
  { id: 'phrygian', title: 'Cadenza frigia (semicadenza)', technique: 'cadenza',
    maj: 'vi iv6/vi V/vi', min: 'i iv6 V',
    how: 'Il basso scende di semitono dal VI al V mentre il soprano sale per tono: classica sospensione sul V, tipica dei movimenti lenti barocchi.',
    weight: { song: 0, ballad: 1, symphony: 3, film: 2, chorale: 3, jazz: 0 }, ref: { book: 'armonia1', page: 109, label: 'cadenze' } },
  { id: 'plagal-minor', title: 'Cadenza plagale con iv minore', technique: 'colore',
    maj: 'I IV iv I', min: 'i iv VI i',
    how: 'Il IV diventa minore (prestito modale): la 3ª del IV scende di semitono e va alla 5ª della tonica. Effetto "malinconico" molto usato nel pop e nel cinema.',
    weight: { song: 3, ballad: 3, symphony: 1, film: 3, chorale: 1, jazz: 1 } },
  { id: 'picardy', title: 'Terza piccarda', technique: 'cadenza',
    maj: '', min: 'iv iio65 V7 I',
    how: 'Un brano in minore chiude sull\'accordo di tonica maggiore: la 3ª alzata è una sorpresa luminosa nell\'ultimo accordo.',
    weight: { song: 1, ballad: 2, symphony: 2, film: 2, chorale: 3, jazz: 0 }, ref: { book: 'armonia1', page: 109, label: 'cadenze' } },

  { id: 'sec-dominants', title: 'Catena di dominanti secondarie', technique: 'settime',
    maj: 'I V7/vi vi V7/ii ii V7/V V7 I', min: 'i V7/iv iv V7/III III V7/V V7 i',
    how: 'Ogni V7/x tonicizza l\'accordo seguente: la sua 3ª (sensibile locale) sale di semitono, la 7ª scende di grado. Le risoluzioni delle settime guidano tutta la catena.',
    weight: { song: 2, ballad: 2, symphony: 3, film: 2, chorale: 3, jazz: 3 }, ref: { book: 'armonia1', page: 223, label: 'settime secondarie' } },
  { id: 'circle-sevenths', title: 'Progressione di settime per quinte discendenti', technique: 'settime',
    maj: 'Imaj7 IVmaj7 viiø7 iii7 vi7 ii7 V7 I', min: 'i7 iv7 VII7 IIImaj7 VImaj7 iiø7 V7 i',
    how: 'Progressione modulare (marcia): in ogni accordo la 7ª scende di grado e diventa la 3ª del successivo; a voci alterne si lasciano accordi completi e incompleti.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 2, chorale: 3, jazz: 3 }, ref: { book: 'armonia2', page: 26, label: 'progressioni di 7ª' } },
  { id: 'dim7-passing', title: 'Settima diminuita di passaggio', technique: 'settime',
    maj: 'I #io7 ii7 V7 I', min: 'i viio7/iv iv V7 i',
    how: 'La 7ª diminuita è una dominante senza fondamentale (9ª minore): tutte le voci si muovono per semitono verso l\'accordo di arrivo.',
    weight: { song: 2, ballad: 2, symphony: 2, film: 2, chorale: 2, jazz: 3 }, ref: { book: 'armonia1', page: 309, label: '7ª diminuita' } },
  { id: 'suspension', title: 'Ritardo 4-3 sulla dominante', technique: 'settime',
    maj: 'IV V7sus4 V7 I', min: 'iv V7sus4 V7 i',
    how: 'La 4ª è preparata nell\'accordo precedente (consonanza), percossa come dissonanza e risolta scendendo alla 3ª: preparazione–percussione–risoluzione.',
    weight: { song: 3, ballad: 3, symphony: 3, film: 3, chorale: 3, jazz: 1 }, ref: { book: 'armonia2', page: 51, label: 'ritardi' } },
  { id: 'pedal', title: 'Pedale di dominante', technique: 'colore',
    maj: 'I@5 IV@5 viio7@5 V7 I', min: 'i@5 iv@5 viio7@5 V7 i',
    how: 'Il basso tiene la dominante mentre sopra gli accordi cambiano: la tensione cresce finché il pedale "si scioglie" nella cadenza.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 3, chorale: 1, jazz: 0 }, ref: { book: 'armonia2', page: 242, label: 'pedale' } },

  { id: 'mod-dominant', title: 'Modulazione alla dominante (accordo comune)', technique: 'modulazione',
    maj: 'I IV vi [V] ii65 V7 I', min: 'i iv III [v] iio65 V7 i',
    how: 'Il vi della tonalità d\'impianto è anche ii nella tonalità della dominante (affinità di primo grado): lo si reinterpreta come perno e si conferma con V7–I.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 1, chorale: 3, jazz: 1 }, ref: { book: 'armonia1', page: 157, label: 'modulazione per affinità' } },
  { id: 'mod-relative', title: 'Modulazione al relativo', technique: 'modulazione',
    maj: 'I IV [vi] iio65 V7 i', min: 'i VI [III] ii V7 I',
    how: 'Il IV (in maggiore) è VI del relativo minore: accordo perno, poi la dominante del relativo con la sensibile alzata.',
    weight: { song: 2, ballad: 3, symphony: 3, film: 2, chorale: 3, jazz: 1 }, ref: { book: 'armonia1', page: 157, label: 'modulazione per affinità' } },
  { id: 'mod-step', title: 'Salto di tono per il ritornello finale', technique: 'modulazione',
    maj: 'I V vi IV V7/II [II] I V vi IV', min: 'i VI III VII V7/ii [ii] i VI III VII',
    how: 'Modulazione diretta un tono sopra preparata dalla dominante della nuova tonalità: il "truck driver change" dell\'ultimo ritornello.',
    weight: { song: 3, ballad: 2, symphony: 0, film: 1, chorale: 0, jazz: 0 }, ref: { book: 'armonia1', page: 151, label: 'modulazione' } },
  { id: 'mod-sequence', title: 'Progressione modulante (marcia imitata)', technique: 'modulazione',
    maj: 'I V7/ii ii V7/iii iii V7/IV IV V7 I', min: 'i V7/iv iv V7/V V7 i',
    how: 'Lo stesso modello (V7→accordo) ripetuto a gradi diversi: ogni ripetizione tonicizza un nuovo grado, la sequenza fa da ponte verso la cadenza.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 2, chorale: 2, jazz: 2 }, ref: { book: 'armonia2', page: 79, label: 'progressioni modulanti' } },
  { id: 'mod-enharmonic', title: 'Modulazione enarmonica con la 7ª diminuita', technique: 'modulazione',
    maj: 'I viio7/V [iii] viio7 i V7 i', min: 'i viio7 [iii] viio7 i V7 i',
    how: 'La 7ª diminuita è simmetrica: rileggendo enarmonicamente una sua nota come sensibile, lo stesso accordo risolve in una tonalità lontana.',
    weight: { song: 0, ballad: 1, symphony: 3, film: 3, chorale: 2, jazz: 1 }, ref: { book: 'armonia1', page: 188, label: 'trasformazione enarmonica' } },
  { id: 'mod-mediant', title: 'Mediante cromatica', technique: 'modulazione',
    maj: 'I bVI I III I', min: 'i #III VI i',
    how: 'Accordi maggiori a distanza di terza con una nota comune e le altre per semitono: nessuna funzione tonale, solo "luce" e spazio. Lingua tipica del cinema.',
    weight: { song: 1, ballad: 1, symphony: 2, film: 3, chorale: 0, jazz: 0 }, ref: { book: 'armonia2', page: 105, label: 'enarmonia' } },

  { id: 'neapolitan', title: 'Sesta napoletana', technique: 'cromatismo',
    maj: 'I vi N6 Cad64 V7 I', min: 'i VI N6 Cad64 V7 i',
    how: 'Accordo maggiore sul II abbassato, in primo rivolto (basso sul IV grado). Il II abbassato scende per terza diminuita alla sensibile.',
    weight: { song: 1, ballad: 2, symphony: 3, film: 3, chorale: 3, jazz: 0 }, ref: { book: 'armonia2', page: 142, label: 'sesta napoletana' } },
  { id: 'aug6', title: 'Sesta aumentata (tedesca → 6/4 → V)', technique: 'cromatismo',
    maj: 'I IV Ger6 Cad64 V7 I', min: 'i iv Ger6 Cad64 V7 i',
    how: 'Il VI abbassato nel basso e il IV alzato nel soprano formano la 6ª aumentata, che si allarga all\'ottava sulla dominante (passando per il 6/4 per evitare le quinte).',
    weight: { song: 0, ballad: 1, symphony: 3, film: 2, chorale: 3, jazz: 0 }, ref: { book: 'armonia2', page: 140, label: 'sesta aumentata' } },
  { id: 'aug6-fr', title: 'Sesta aumentata francese', technique: 'cromatismo',
    maj: 'vi Fr6 V7 I', min: 'VI Fr6 V7 i',
    how: 'Come la tedesca ma con la 4ª aumentata sul basso: il suono "a toni interi" va direttamente sul V senza quinte parallele.',
    weight: { song: 0, ballad: 1, symphony: 3, film: 3, chorale: 2, jazz: 1 }, ref: { book: 'armonia2', page: 140, label: 'sesta aumentata' } },
  { id: 'tritone', title: 'Sostituzione di tritono', technique: 'cromatismo',
    maj: 'Imaj7 vi7 ii7 bII7 Imaj7', min: 'i7 VImaj7 iiø7 bII7 i7',
    how: 'Il bII7 condivide il tritono del V7 (3ª e 7ª scambiate): il basso scende per semitono alla tonica. È parente stretta della sesta aumentata.',
    weight: { song: 1, ballad: 1, symphony: 0, film: 1, chorale: 0, jazz: 3 }, ref: { book: 'armonia2', page: 140, label: 'sesta aumentata' } },
  { id: 'backdoor', title: 'Cadenza "backdoor" (iv7–bVII7–I)', technique: 'colore',
    maj: 'Imaj7 iv7 bVII7 Imaj7', min: 'i iv7 VII7 III',
    how: 'Dominante "dalla porta di servizio": il bVII7 risolve sulla tonica con la 7ª che scende alla 5ª e la fondamentale che sale di tono.',
    weight: { song: 2, ballad: 2, symphony: 0, film: 2, chorale: 0, jazz: 3 } },
  { id: 'modal-mixture', title: 'Prestito modale (bVI–bVII–I)', technique: 'colore',
    maj: 'I bVI bVII I', min: 'i VI VII I',
    how: 'Accordi presi dal modo minore omologo: il VI e il VII abbassati salgono per tono verso la tonica, cadenza "eroica" senza sensibile.',
    weight: { song: 3, ballad: 2, symphony: 1, film: 3, chorale: 0, jazz: 1 } },
];

export interface Suggestion {
  id: string; title: string; technique: Technique; how: string; score: number;
  chords: Realized[]; line: string; ref?: Ref; keyChanges: string[];
}

/** Suggerimenti per tonalità e tipo; il tipo decide l'ordine, la tecnica può filtrare. */
export function suggest(keyText: string, type: CompositionType, technique?: Technique): Suggestion[] {
  const t: Tonality = tonalityFromText(keyText) || { letter: 0, pc: 0, minor: false };
  const out: Suggestion[] = [];
  for (const m of MODELS) {
    if (technique && m.technique !== technique) continue;
    if (!(t.minor ? m.min : m.maj)) continue;
    const score = m.weight[type] ?? 0;
    if (score === 0 && !technique) continue;
    let chords: Realized[];
    try { chords = realize(t.minor ? m.min : m.maj, t); } catch { continue; }
    out.push({ id: m.id, title: m.title, technique: m.technique, how: m.how, score, chords, ref: m.ref,
      line: chords.map(c => c.chord).join(' '), keyChanges: chords.filter(c => c.keyChange).map(c => c.keyChange!) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function homeLabel(keyText: string) {
  const t = tonalityFromText(keyText);
  return t ? tonalityLabel(t) : 'C major';
}

// ---------- esercizi di basso dato per livello ----------
export const EXERCISE_LEVELS = [
  { id: 1, label: '1 · Triadi e rivolti' },
  { id: 2, label: '2 · Accordi di settima' },
  { id: 3, label: '3 · Modulazioni' },
  { id: 4, label: '4 · Alterazioni cromatiche' },
] as const;

interface Drill { title: string; maj: string; min: string; ref: Ref; }
const DRILLS: Record<number, Drill[]> = {
  1: [
    { title: 'Cadenza perfetta', maj: 'I IV V I', min: 'i iv V i', ref: { book: 'armonia1', page: 109, label: 'cadenze' } },
    { title: 'Giro con il VI grado', maj: 'I vi IV V I', min: 'i VI iv V i', ref: { book: 'armonia1', page: 62, label: 'raddoppi' } },
    { title: 'Primo rivolto del II', maj: 'I ii6 V I', min: 'i iio6 V i', ref: { book: 'armonia1', page: 62, label: 'raddoppi' } },
    { title: 'Rivolti nel basso', maj: 'I I6 IV V I', min: 'i i6 iv V i', ref: { book: 'armonia1', page: 62, label: 'raddoppi' } },
    { title: '6/4 cadenzale', maj: 'I vi ii6 Cad64 V I', min: 'i VI iio6 Cad64 V i', ref: { book: 'armonia1', page: 109, label: 'cadenze' } },
    { title: 'Cadenza evitata', maj: 'I IV V vi IV V I', min: 'i iv V VI iv V i', ref: { book: 'armonia1', page: 116, label: 'cadenza evitata' } },
  ],
  2: [
    { title: 'II di settima e dominante', maj: 'I ii65 V7 I', min: 'i iio65 V7 i', ref: { book: 'armonia1', page: 204, label: 'risoluzione della 7ª' } },
    { title: 'Rivolti della dominante', maj: 'I V42 I6 V65 I', min: 'i V42 i6 V65 i', ref: { book: 'armonia1', page: 209, label: '7ª di 1ª specie' } },
    { title: 'Settime secondarie', maj: 'I IV ii7 V7 I', min: 'i iv iiø7 V7 i', ref: { book: 'armonia1', page: 223, label: 'settime secondarie' } },
    { title: 'Dominante della dominante', maj: 'I IV V7/V V7 I', min: 'i iv V7/V V7 i', ref: { book: 'armonia1', page: 223, label: 'settime secondarie' } },
    { title: '7ª diminuita sulla sensibile', maj: 'I viio7 I ii65 V7 I', min: 'i viio7 i iio65 V7 i', ref: { book: 'armonia1', page: 309, label: '7ª diminuita' } },
  ],
  3: [], 4: [],
};

/** Esercizi del livello, realizzati nella tonalità indicata (i livelli 3 e 4 usano i modelli degli sviluppi). */
export function exerciseModels(level: number, keyText: string): Suggestion[] {
  const t: Tonality = tonalityFromText(keyText) || { letter: 0, pc: 0, minor: false };
  if (level === 3 || level === 4) {
    const ids = level === 3 ? ['mod-dominant', 'mod-relative', 'mod-sequence', 'mod-enharmonic'] : ['neapolitan', 'aug6', 'aug6-fr', 'dim7-passing', 'phrygian'];
    return suggest(keyText, 'chorale').filter((s) => ids.includes(s.id));
  }
  return (DRILLS[level] || []).map((d, i) => {
    const chords = realize(t.minor ? d.min : d.maj, t);
    return { id: `drill-${level}-${i}`, title: d.title, technique: 'cadenza' as Technique, how: '', score: 3, chords, line: chords.map((c) => c.chord).join(' '), ref: d.ref, keyChanges: [] };
  });
}
