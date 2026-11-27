// Partitura integrata: riproduzione del MIDI dell'orchestrazione con un soundfont General MIDI (spessasynth, AudioWorklet).
// La libreria e il soundfont si caricano solo al primo ascolto; un solo motore per tutta l'app.
import { api } from './api';

type Lib = typeof import('spessasynth_lib');
type Seq = InstanceType<Lib['Sequencer']>;
type Synth = InstanceType<Lib['WorkletSynthesizer']>;

let shared: Promise<ScoreEngine> | null = null;

export class ScoreEngine {
  private constructor(private ctx: AudioContext, private synth: Synth, private seq: Seq, private gain: GainNode, readonly bank: string, readonly custom: boolean) {}
  private port: MIDIOutput | null = null;
  private muted = new Set<number>();

  /** Il motore condiviso (lo crea al primo uso). Se il soundfont manca o non si carica, l'errore spiega cosa fare. */
  static get(): Promise<ScoreEngine> {
    if (!shared) shared = ScoreEngine.create().catch((e) => { shared = null; throw e; });
    return shared;
  }
  /** Da chiamare dopo aver scelto un altro soundfont: il prossimo ascolto ricrea il motore. */
  static async reset() {
    const old = shared; shared = null;
    if (old) { try { const e = await old; e.seq.pause(); await e.ctx.close(); } catch { /* già chiuso */ } }
  }

  private static async create(): Promise<ScoreEngine> {
    const sf = await api.soundfont();
    if (!sf) throw new Error('Nessun soundfont disponibile: scegline uno (.sf2 o .sf3) con «Soundfont…».');
    const { WorkletSynthesizer, Sequencer } = await import('spessasynth_lib');
    const ctx = new AudioContext({ latencyHint: 'playback' });
    await ctx.audioWorklet.addModule(new URL('spessasynth_processor.min.js', document.baseURI).href);
    const synth = new WorkletSynthesizer(ctx);
    const gain = ctx.createGain();
    gain.gain.value = 0.9;
    synth.connect(gain);
    gain.connect(ctx.destination);
    await synth.isReady;
    const data = sf.data;
    await synth.soundBankManager.addSoundBank(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, 'main');
    const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
    seq.loopCount = 0;
    return new ScoreEngine(ctx, synth, seq, gain, sf.name, sf.custom);
  }

  /** Carica il MIDI e restituisce la durata in secondi (resta in pausa all'inizio). */
  async load(mid: Uint8Array, name: string): Promise<number> {
    this.seq.pause();
    const done = new Promise<void>((res) => {
      const t = setTimeout(res, 4000);
      this.seq.eventHandler.addEvent('songChange', 'score-load', () => { clearTimeout(t); res(); });
    });
    this.seq.loadNewSongList([{ binary: mid.buffer.slice(mid.byteOffset, mid.byteOffset + mid.byteLength) as ArrayBuffer, fileName: name }]);
    await done;
    this.seq.pause();
    this.seq.currentTime = 0;
    this.applyMutes();
    return this.seq.duration;
  }

  async play() { if (this.ctx.state !== 'running') await this.ctx.resume(); this.seq.play(); }
  pause() { this.seq.pause(); this.synth.stopAll(true); }
  /** Fine naturale: si ferma senza troncare le code delle note. */
  finish() { this.seq.pause(); }
  get paused() { return this.seq.paused; }
  get time() { return this.seq.currentTime; }
  set time(t: number) { this.seq.currentTime = Math.max(0, t); }
  get duration() { return this.seq.duration; }
  set rate(r: number) { this.seq.playbackRate = r; }
  set volume(v: number) { this.gain.gain.value = v; }

  setMuted(channels: number[]) { this.muted = new Set(channels); this.applyMutes(); }
  private applyMutes() {
    this.synth.midiChannels.forEach((c, i) => c.setSystemParameter('isMuted', this.muted.has(i)));
  }

  /** Suona su una porta MIDI (es. loopMIDI verso Cubase o Komplete Kontrol) invece che con il soundfont. */
  setOutput(port: MIDIOutput | null) {
    if (this.port === port) return;
    if (this.port) { try { this.seq.disconnectMIDIOutput(this.port); } catch { /* già scollegata */ } }
    this.port = port;
    if (port) this.seq.connectMIDIOutput(port);
  }
}
