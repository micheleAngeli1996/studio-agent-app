// Test della logica musicale dell'interfaccia (senza Angular): gradi, suggerimenti, cadenze, disposizioni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realize, tonalityFromText } from '../ui/src/app/roman';
import { suggest, exerciseModels } from '../ui/src/app/suggestions';
import { analyze, parseProgression, chordTones, isChordLine } from '../ui/src/app/harmony';
import { voiceLead } from '../ui/src/app/piano';

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
