export interface Track { name: string; role: string; instrument: string; }
export interface Decision { date: string; agent: string; text: string; }
export interface MixVersion { date: string; file: string; lufs: string; truePeak: string; note: string; }
export interface SongFile { name: string; kind: string; path: string; }
export interface Song {
  name: string; title: string; path: string; relPath: string; key: string; tempo: string; phase: string; goal: string;
  progression?: string; tracks: Track[]; decisions: Decision[]; versions: MixVersion[]; files: SongFile[];
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
export interface Analysis { ok: boolean; data?: Record<string, any>; message?: string; }

export interface StudioApi {
  info(): Promise<{ root: string; hasAgents: boolean; version?: string }>;
  chooseRoot(): Promise<{ ok: boolean; root: string; message?: string }>;
  listSongs(): Promise<Song[]>;
  createSong(d: { title: string; bpm?: string; key?: string }): Promise<Song>;
  addDecision(song: string, agent: string, text: string): Promise<Song>;
  addVersion(song: string, v: { file: string; lufs: string; truePeak: string; note: string }): Promise<Song>;
  setProgression(song: string, prog: string): Promise<Song>;
  exportMidi(req: { song?: string; progression: string; bpm?: string; key?: string; name?: string }): Promise<{ ok: boolean; path?: string; message?: string }>;
  checkVoices(v: { s: string; a: string; t: string; b: string }): Promise<{ ok: boolean; errors?: boolean; report?: string; message?: string }>;
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
    files: [],
  };
  const songs = [song];
  const log: UsageEntry[] = [];
  let listener: (id: string, ev: AgentEvent) => void = () => {};
  return {
    info: async () => ({ root: '(anteprima)', hasAgents: true, version: 'anteprima' }),
    chooseRoot: async () => ({ ok: false, root: '(anteprima)', message: 'Disponibile solo nell\'app.' }),
    listSongs: async () => structuredClone(songs),
    createSong: async (d) => { const s = { ...structuredClone(song), name: d.title, title: d.title, key: d.key || '', tempo: `${d.bpm || ''} BPM, 4/4`, phase: 'idea', decisions: [], versions: [] }; songs.push(s); return s; },
    addDecision: async (n, agent, text) => { const s = songs.find((x) => x.name === n)!; s.decisions.push({ date: new Date().toISOString().slice(0, 10), agent, text }); return structuredClone(s); },
    addVersion: async (n, v) => { const s = songs.find((x) => x.name === n)!; s.versions.push({ date: new Date().toISOString().slice(0, 10), ...v }); return structuredClone(s); },
    setProgression: async (n, prog) => { const s = songs.find((x) => x.name === n)!; s.progression = prog; return structuredClone(s); },
    exportMidi: async (r) => ({ ok: true, path: `songs/${r.song}/midi/${r.name || 'progression'}.mid`, message: 'Anteprima: nessun file scritto' }),
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
