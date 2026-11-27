// Test della logica musicale dell'interfaccia (senza Angular): gradi, suggerimenti, cadenze, disposizioni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realize, tonalityFromText } from '../ui/src/app/roman';
import { suggest, exerciseModels } from '../ui/src/app/suggestions';
import { analyze, parseProgression, chordTones, isChordLine } from '../ui/src/app/harmony';
import { voiceLead } from '../ui/src/app/piano';
import { readMidi, secToQuarters, quartersToSec, stepAt, pairScores, clock } from '../ui/src/app/score-time';
import { readPortTracks, chase, PortPlayer } from '../ui/src/app/score-ports';
import { readFileSync } from 'node:fs';

const line = (tpl: string, key: string) => realize(tpl, tonalityFromText(key)!).map((c) => c.chord).join(' ');

test('gradi: ortografia corretta e rivolti', () => {
  assert.equal(line('I ii65 V7 vi', 'C'), 'C Dm7/F G7 Am');
  assert.equal(line('i iio65 V7 i', 'A minor'), 'Am Bm7b5/D E7 Am');
  assert.equal(line('I N6 Cad64 V7 I', 'Eb'), 'Eb Fb/Ab Eb/Bb Bb7 Eb');
  assert.equal(line('I Ger6 V', 'C'), 'C Ab7 G');
  assert.equal(line('I viio7/V V', 'C'), 'C F#dim7 G');
  assert.equal(line('I [V] V7 I', 'C'), 'C D7 G');
});

test('suggerimenti: tutti i modelli producono accordi validi in molte tonalità', () => {
  for (const k of ['C', 'G', 'F', 'Bb', 'Eb', 'A minor', 'E minor', 'F# minor', 'C minor']) {
    for (const s of suggest(k, 'symphony')) {
      for (const c of s.chords) assert.ok(chordTones(c.chord), `${k} · ${s.id}: accordo non valido ${c.chord}`);
      assert.ok(!/##|bbb/.test(s.line), `${k} · ${s.id}: alterazioni doppie in ${s.line}`);
    }
  }
});

test('esercizi: quattro livelli, accordi validi', () => {
  for (const lv of [1, 2, 3, 4]) {
    const ex = exerciseModels(lv, 'A minor');
    assert.ok(ex.length >= 3, `livello ${lv}`);
    ex.forEach((e) => e.chords.forEach((c) => assert.ok(chordTones(c.chord), `${lv}: ${c.chord}`)));
  }
  assert.equal(exerciseModels(2, 'A minor').find((e) => e.title === 'Settime secondarie')!.line, 'Am Dm Bm7b5 E7 Am');
});

test('analisi: gradi e cadenze', () => {
  const cells = analyze('Am Dm E7 Am | F G7 C', 'Am');
  assert.deepEqual(cells.map((c) => c.numeral), ['i', 'iv', 'V7', 'i', 'VI', 'VII7', 'III']);
  assert.equal(cells[3].cadence, 'perfetta');
  assert.match(cells[6].cadence || '', /^perfetta in/);
  assert.equal(analyze('C F G7 Am', 'C')[3].cadence, 'evitata');
});

test('righe di accordi e durate', () => {
  assert.ok(isChordLine('Dm7/F G7 Am'));
  assert.ok(!isChordLine('tools/satb.py'));
  assert.deepEqual(parseProgression('Am:2 E7:2 Am').map((c) => c.beats), [2, 2, 4]);
});

test('disposizione: basso grave, voci superiori vicine', () => {
  const vl = voiceLead(parseProgression('C Am Dm7/F G7 C'));
  for (const v of vl) {
    assert.ok(v.bass >= 36 && v.bass <= 52);
    assert.ok(v.upper[v.upper.length - 1] - v.upper[0] <= 15);
    assert.ok(v.upper[0] > v.bass);
  }
  const moves = vl.slice(1).map((v, i) => v.upper.reduce((s, n, k) => s + Math.abs(n - (vl[i].upper[k] ?? n)), 0));
  assert.ok(Math.max(...moves) <= 10, `movimento eccessivo: ${moves}`);
});

/** MIDI minimo: tempo 120 poi 60 dalla battuta 2; una traccia «Flute» (programma 73) con due note, running status. */
function tinyMidi(): Uint8Array {
  const trk = (b: number[]) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, (b.length >> 8) & 255, b.length & 255, ...b];
  const t0 = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0x8f, 0x00, 0xff, 0x51, 3, 0x0f, 0x42, 0x40, 0, 0xff, 0x2f, 0];
  const t1 = [0, 0xff, 0x03, 5, ...[...'Flute'].map((c) => c.charCodeAt(0)), 0, 0xc0, 73, 0, 0x90, 69, 80, 0x83, 0x60, 69, 0, 0, 72, 80, 0x83, 0x60, 72, 0, 0, 0xff, 0x2f, 0];
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0, ...trk(t0), ...trk(t1)]);
}

test('partitura: tempo, parti e posizione del cursore dal MIDI', () => {
  const m = readMidi(tinyMidi());
  assert.equal(m.tpq, 480);
  assert.deepEqual(m.parts, [{ name: 'Flute', channel: 0, program: 73, notes: 2 }]);
  assert.equal(m.tempos.length, 2);
  assert.equal(m.tempos[1].sec, 2);                  // 4 quarti a 120 = 2 s
  assert.equal(secToQuarters(m, 1), 2);
  assert.equal(secToQuarters(m, 3), 5);              // dopo il cambio: 1 quarto al secondo
  assert.equal(quartersToSec(m, 5), 3);
  assert.equal(stepAt([0, 1, 2, 4], 3.5), 2);
  assert.equal(stepAt([0, 1, 2, 4], 4), 3);
  assert.equal(clock(75.6), '1:15');
});

test('partitura: abbina MusicXML, MIDI, sorgente JSON e MIDI per BBCSO', () => {
  const f = (name: string, kind = 'score', mtime?: number) => ({ name, kind, path: 'score/' + name, mtime });
  assert.deepEqual(pairScores([f('Theme.musicxml'), f('Theme.mid'), f('Sketch.mid'), f('notes.txt'), f('x.mid', 'midi')]),
    [{ name: 'Sketch', mid: 'score/Sketch.mid' }, { name: 'Theme', xml: 'score/Theme.musicxml', mid: 'score/Theme.mid' }]);
  const [p] = pairScores([f('O.json', 'score', 5), f('O.bbcso.mid', 'score', 9), f('O.musicxml', 'score', 4), f('O.mid', 'score', 4)]);
  assert.equal(p.name, 'O'); assert.equal(p.json, 'score/O.json'); assert.equal(p.bbcso, 'score/O.bbcso.mid');
  assert.equal(p.jsonTime, 5); assert.equal(p.bbcsoTime, 9); assert.equal(p.stamp, '4/4');
});

const BBC = new Uint8Array(readFileSync('tests/fixtures/score.bbcso.mid'));

test('BBCSO: tracce con porta loopMIDI e key switch, stato da ripristinare a metà brano', () => {
  const tr = readPortTracks(BBC);
  const cello = tr.find((t) => t.name === 'Cello')!;
  assert.equal(cello.port, 'SA Cello');
  assert.deepEqual(cello.keyswitches, [1, 6]);
  assert.equal(cello.events[0].t, 0);
  // all'inizio pizzicato (key switch 6); a battuta 4 (9 s a 80 BPM) della partitura di prova già arco (key switch 1) e CC1
  const at = chase(cello, 9.5);
  assert.ok(at.some((d) => (d[0] & 0xf0) === 0x90 && d[1] === 1 && d[2] > 0), 'key switch arco');
  assert.ok(at.some((d) => (d[0] & 0xf0) === 0xb0 && d[1] === 1), 'CC1');
  assert.ok(!chase(cello, 0).length);
});

test('BBCSO: ogni parte esce sulla sua porta, le parti silenziate no', async () => {
  const sent: Record<string, number[][]> = {};
  const out = (name: string) => ({ name, id: name, send: (d: number[]) => { (sent[name] ??= []).push([...d]); } });
  const ports = ['SA Flute', 'SA Cello', 'SA Violin I'].map(out);
  const only = (names: string[]) => ({ outputs: new Map(ports.filter((o) => names.includes(o.name)).map((o) => [o.id, o])) }) as unknown as MIDIAccess;
  assert.deepEqual(new PortPlayer(BBC, only(['SA Flute'])).resolve(), ['SA Violin I', 'SA Cello']);
  const pl = new PortPlayer(BBC, only(['SA Flute', 'SA Cello', 'SA Violin I']));
  assert.deepEqual(pl.resolve(), []);
  pl.setMuted([], ['Violin I']);
  pl.setRate(8);                               // otto volte più veloce: il test dura poco
  await pl.play();
  await new Promise((r) => setTimeout(r, 400));
  pl.pause();
  assert.ok(sent['SA Cello'].some((d) => (d[0] & 0xf0) === 0x90 && d[1] === 6), 'key switch pizzicato al violoncello');
  assert.ok(sent['SA Flute'].some((d) => (d[0] & 0xf0) === 0x90 && d[1] > 60), 'note del flauto');
  assert.ok(!(sent['SA Violin I'] ?? []).some((d) => (d[0] & 0xf0) === 0x90), 'violini silenziati');
  assert.ok(sent['SA Cello'].some((d) => d[0] === 0xb0 && d[1] === 123), 'note spente alla pausa');
});
