export interface Track { name: string; role: string; instrument: string; }
export interface Decision { date: string; agent: string; text: string; }
export interface MixVersion { date: string; file: string; lufs: string; truePeak: string; note: string; }
export interface SongFile { name: string; kind: string; path: string; mtime?: number; }
export interface Song {
  name: string; title: string; path: string; relPath: string; key: string; tempo: string; phase: string; goal: string;
  progression?: string; form?: string; sections?: { section: string; progression: string }[]; compositionType?: string; tracks: Track[]; decisions: Decision[]; versions: MixVersion[]; files: SongFile[];
}
export interface UsageEntry {
  ts: string; agent: string; song: string; phase: string; request: string; input: number; output: number;
  cacheRead?: number; durationMs: number; turns?: number; costUsd?: number | null; ok?: boolean;
}
export type AgentEvent =
  | { type: 'start'; sessionId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'blockstart' }
  | { type: 'limits'; fiveHour: LimitWindow | null; sevenDay: LimitWindow | null }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'done'; ok: boolean; result: string; sessionId: string; durationMs: number; turns: number; costUsd: number | null;
      usage: { input: number; output: number; cacheRead: number }; message: string }
  | { type: 'error'; message: string };
export interface LimitWindow { utilization: number; resetsAt: number; status: string; }
export interface Limits { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; at?: string; }
export interface AskRequest { agent: string; prompt: string; resume?: string; song?: string; phase?: string; label?: string; }
export interface Arrangement {
  ok: boolean; message?: string; bpm?: number; beatsPerBar?: number; length?: number; form?: string[]; missing?: string[]; auto?: string[];
  markers?: { t: number; name: string }[]; notes?: [number, number, number, number, number][]; cc?: [number, number, number, number][]; file?: string | null;
}
export interface Comparison {
  ok: boolean; message?: string; a?: string; b?: string; ref?: boolean;
  rows?: { label: string; a: number; b: number; d: number; unit: string }[];
  bands?: { name: string; a: number; b: number; d: number }[];
  summary?: string[]; spectrumA?: [number, number][]; spectrumB?: [number, number][];
}
export interface Satb { ok: boolean; s?: string; a?: string; t?: string; b?: string; chords?: string[]; files?: string[]; message?: string; }
export interface Analysis { ok: boolean; data?: Record<string, any>; message?: string; }

export interface StudioApi {
  info(): Promise<{ root: string; hasAgents: boolean; version?: string }>;
  midiApps(): Promise<{ windows: boolean; loopmidi: { running: boolean; path: string }; kk: { running: boolean; path: string } }>;
  launchMidiApp(which: 'kk' | 'loopmidi'): Promise<{ ok: boolean; message?: string }>;
  readFile(path: string): Promise<Uint8Array | null>;
  soundfont(): Promise<{ name: string; custom: boolean; data: Uint8Array } | null>;
  pickSoundfont(reset?: boolean): Promise<boolean>;
  pythonInfo(again?: boolean): Promise<{ path: string; version: string; missing: string[] }>;
  chooseRoot(): Promise<{ ok: boolean; root: string; message?: string }>;
  listSongs(): Promise<Song[]>;
  createSong(d: { title: string; bpm?: string; key?: string }): Promise<Song>;
  addDecision(song: string, agent: string, text: string): Promise<Song>;
  addVersion(song: string, v: { file: string; lufs: string; truePeak: string; note: string }): Promise<Song>;
  setProgression(song: string, prog: string, section?: string): Promise<Song>;
  setCompositionType(song: string, type: string): Promise<Song>;
  exportMidi(req: { song?: string; progression: string; bpm?: string; key?: string; name?: string }): Promise<{ ok: boolean; path?: string; message?: string }>;
  checkVoices(v: { s: string; a: string; t: string; b: string; chords?: string; key?: string }): Promise<{ ok: boolean; errors?: boolean; report?: string; message?: string }>;
  arrange(req: { song?: string; style: string; melody?: boolean; instrument?: string; form?: string; write?: boolean }): Promise<Arrangement>;
  setForm(song: string, form: string): Promise<Song>;
  realizeSatb(req: { song?: string; progression: string; bpm?: string; key?: string; name?: string; write?: boolean; exercise?: boolean }): Promise<Satb>;
  compareAudio(req: { song?: string; a: string; b: string; ref?: boolean }): Promise<Comparison>;
  analyzeMidi(song?: string): Promise<{ ok: boolean; canceled?: boolean; message?: string; progression?: string; key?: string; bars?: number; file?: string }>;
  bookPage(book: string, page: number): Promise<{ ok: boolean; dataUrl?: string; message?: string }>;
  openBook(book: string): Promise<string>;
  openReader(book: string, page: number): Promise<{ ok: boolean; message?: string }>;
  analyze(path: string): Promise<Analysis>;
  pickAudio(): Promise<string | null>;
  pathForFile(f: File): string;
  usage(): Promise<UsageEntry[]>;
  limits(): Promise<Limits | null>;
  openPath(p: string): Promise<string>;
  ask(req: AskRequest): Promise<string>;
  cancel(id: string): Promise<void>;
  onAgentEvent(cb: (id: string, ev: AgentEvent) => void): () => void;
}

// ---- Anteprima nel browser (senza Electron): dati dimostrativi, nessuna chiamata a Claude ----
function demoApi(): StudioApi {
  const song: Song = {
    name: 'Test in A minor', title: 'Test in A minor', path: '', relPath: 'songs/Test in A minor/SONG.md',
    key: 'A minor, con modulazione a C major', tempo: '80 BPM, 4/4', phase: 'mix', goal: 'esercizio',
    progression: 'Am Dm E7 Am | Am Dm E7 F | Dm G7 C Am | Dm G7 C C',
    tracks: [['Flute', 'melodia'], ['Strings', 'accompagnamento (pad)'], ['Piano', 'accompagnamento'], ['Electric Bass', 'basso'], ['Drums', 'batteria']]
      .map(([name, role]) => ({ name, role, instrument: '' })),
    decisions: [{ date: '2026-11-11', agent: 'regola di progetto', text: 'ordine delle tracce: melodia, accompagnamento armonico, basso e batteria' }],
    versions: [{ date: '2026-11-11', file: 'test/brano-prova/mix_problematic.wav', lufs: '−8,7', truePeak: '−0,08 dBTP', note: 'da rifare al mix' }],
    files: ['score_example.musicxml', 'score_example.mid'].map((name) => ({ name, kind: 'score', path: 'demo/' + name })),
  };
  const songs = [song];
  const log: UsageEntry[] = [];
  let listener: (id: string, ev: AgentEvent) => void = () => {};
  return {
    info: async () => ({ root: '(anteprima)', hasAgents: true, version: 'anteprima' }),
    midiApps: async () => ({ windows: false, loopmidi: { running: true, path: '' }, kk: { running: true, path: '' } }),
    launchMidiApp: async () => ({ ok: true }),
    readFile: async (p) => { try { const r = await fetch(p); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } },
    soundfont: async () => { try { const r = await fetch('demo/soundfont.sf3'); return r.ok ? { name: 'soundfont di prova', custom: false, data: new Uint8Array(await r.arrayBuffer()) } : null; } catch { return null; } },
    pickSoundfont: async () => false,
    pythonInfo: async () => ({ path: 'python', version: '3.13.5', missing: [] }),
    chooseRoot: async () => ({ ok: false, root: '(anteprima)', message: 'Disponibile solo nell\'app.' }),
    listSongs: async () => structuredClone(songs),
    createSong: async (d) => { const s = { ...structuredClone(song), name: d.title, title: d.title, key: d.key || '', tempo: `${d.bpm || ''} BPM, 4/4`, phase: 'idea', decisions: [], versions: [] }; songs.push(s); return s; },
    addDecision: async (n, agent, text) => { const s = songs.find((x) => x.name === n)!; s.decisions.push({ date: new Date().toISOString().slice(0, 10), agent, text }); return structuredClone(s); },
    addVersion: async (n, v) => { const s = songs.find((x) => x.name === n)!; s.versions.push({ date: new Date().toISOString().slice(0, 10), ...v }); return structuredClone(s); },
    setProgression: async (n, prog, sec) => {
      const s = songs.find((x) => x.name === n)!;
      const list = s.sections ?? (s.sections = [{ section: '', progression: s.progression || '' }]);
      const hit = list.find((x) => x.section === (sec || ''));
      if (hit) hit.progression = prog; else list.push({ section: sec || '', progression: prog });
      if (!sec) s.progression = prog;
      return structuredClone(s);
    },
    setCompositionType: async (n, type) => { const s = songs.find((x) => x.name === n)!; s.compositionType = type; return structuredClone(s); },
    exportMidi: async (r) => ({ ok: true, path: `songs/${r.song}/midi/${r.name || 'progression'}.mid`, message: 'Anteprima: nessun file scritto' }),
    arrange: async () => ({ ok: true, bpm: 90, beatsPerBar: 4, length: 8, form: ['Main'], missing: [], auto: [], markers: [{ t: 0, name: 'Main' }],
      notes: [[0, 2, 45, 90, 1], [0, 2, 60, 70, 0], [0, 2, 64, 70, 0], [0, 2, 69, 70, 0], [0, 0.25, 36, 100, 9], [1, 0.25, 38, 90, 9], [2, 2, 41, 90, 1], [2, 2, 60, 70, 0], [2, 2, 65, 70, 0], [2, 2, 69, 70, 0], [4, 4, 45, 90, 1], [4, 4, 64, 70, 0], [4, 4, 69, 70, 0], [4, 4, 72, 70, 0]], cc: [], file: null }),
    compareAudio: async (r) => ({ ok: true, a: 'mix_v2.wav', b: r.b, ref: !!r.ref,
      rows: [{ label: 'Loudness integrato', a: -14.2, b: -16.1, d: 1.9, unit: 'LU' }, { label: 'True peak', a: -1.2, b: -2.4, d: 1.2, unit: 'dB' }, { label: 'Crest factor', a: 9.1, b: 11.4, d: -2.3, unit: 'dB' }],
      bands: [{ name: 'bassi 60-250 Hz', a: -6.1, b: -9.4, d: 3.3 }, { name: 'medi 500 Hz-2 kHz', a: -8.2, b: -7.9, d: -0.3 }],
      summary: ['A è più forte di B di 1.9 LU.', 'bassi 60-250 Hz: A ha 3.3 dB in più di B.'],
      spectrumA: Array.from({ length: 31 }, (_, i) => [1000 * 2 ** ((i - 17) / 3), -20 - Math.abs(i - 10) * 1.2] as [number, number]),
      spectrumB: Array.from({ length: 31 }, (_, i) => [1000 * 2 ** ((i - 17) / 3), -21 - Math.abs(i - 12) * 1.1] as [number, number]) }),
    analyzeMidi: async () => ({ ok: true, progression: 'Am F C G | Am F E7 Am', key: 'Am', bars: 8, file: 'demo.mid' }),
    setForm: async (n, form) => { const s = songs.find((x) => x.name === n)!; s.form = form; return structuredClone(s); },
    realizeSatb: async () => ({ ok: true, s: 'A4 A4 G#4 A4', a: 'E4 F4 E4 E4', t: 'C4 D4 D4 C4', b: 'A2 D3 E2 A2', files: [] }),
    checkVoices: async () => ({ ok: true, errors: true, report: '[ERRORE] accordo 2: quinte parallele tra Tenore e Basso (accordi 2-3: Do4/Fa3 -> Re4/Sol3)\n\n1 errori, 0 avvisi su 4 accordi.' }),
    bookPage: async () => ({ ok: false, message: 'Anteprima: le pagine dei manuali si vedono solo nell\'app.' }),
    openBook: async () => '',
    openReader: async () => ({ ok: false, message: 'Il lettore PDF funziona solo nell\'app.' }),
    analyze: async (p) => ({ ok: true, data: {
      file: p, durata_s: 51, picco_campione_dBFS: -0.09, true_peak_dBTP_stima: -0.08, loudness_integrato_LUFS: -8.71, crest_factor_dB: 10.42,
      correlazione_stereo: 0.928, energia_per_banda_dB_rispetto_al_totale: { 'sub 20-60 Hz': -30.5, 'bassi 60-250 Hz': -0.5, 'medio-bassi 250-500 Hz': -10.5,
        'medi 500 Hz-2 kHz': -17.4, 'medio-alti 2-6 kHz': -31.1, 'alti 6-12 kHz': -31.6, 'aria 12-20 kHz': -30.3 } } }),
    pickAudio: async () => 'test/brano-prova/mix_problematic.wav',
    pathForFile: (f) => f.name,
    usage: async () => structuredClone(log),
    limits: async () => ({ fiveHour: { utilization: 0.04, resetsAt: Date.now() / 1000 + 9000, status: 'allowed' }, sevenDay: { utilization: 0.44, resetsAt: Date.now() / 1000 + 300000, status: 'allowed' } }),
    openPath: async () => '',
    ask: async (req) => {
      const id = 'demo-' + Date.now();
      setTimeout(() => listener(id, { type: 'start', sessionId: 'demo' }), 150);
      setTimeout(() => listener(id, { type: 'tool', name: 'Read', summary: 'Legge songs/Test in A minor/SONG.md' }), 500);
      ['**Anteprima** ', 'in tempo ', 'reale: ', 'il testo ', 'arriva ', 'a pezzi.'].forEach((t, i) => setTimeout(() => listener(id, { type: 'delta', text: t }), 600 + i * 70));
      setTimeout(() => listener(id, { type: 'blockstart' }), 1050);
      setTimeout(() => listener(id, { type: 'text', text: `**Anteprima senza Claude Code.** Qui comparirà la risposta dell'agente \`${req.agent}\`.\n\n1. Primo intervento consigliato.\n2. Secondo intervento.\n\n| Misura | Valore |\n|---|---|\n| LUFS | −8,7 |` }), 1100);
      setTimeout(() => {
        log.push({ ts: new Date().toISOString(), agent: req.agent, song: req.song || '', phase: req.phase || '', request: (req.label || req.prompt).slice(0, 90), input: 32000, output: 640, durationMs: 4200 });
        listener(id, { type: 'done', ok: true, result: '', sessionId: 'demo', durationMs: 4200, turns: 2, costUsd: null, usage: { input: 32000, output: 640, cacheRead: 30000 }, message: '' });
      }, 1500);
      return id;
    },
    cancel: async () => {},
    onAgentEvent: (cb) => { listener = cb; return () => {}; },
  };
}

export const api: StudioApi = (window as any).studio ?? demoApi();
export const isDemo = !(window as any).studio;
