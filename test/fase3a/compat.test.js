// Compatibilidade entre os módulos novos (Fase 3a) e os existentes (Fases 1 e 2), sem alterá-los.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOTTERIES } from '../../src/lotteries/config.js';
import { LOTTERY_IDS, resultRules } from '../../src/data/schema.js';
import { RESULT_VALIDATORS } from '../../src/validation/result.js';
import { normalizeRaw } from '../../src/data/normalize.js';
import { canonicalize } from '../../src/integrity/jcs.js';
import * as lab from '../../src/lab.js';
import { env } from './_helpers.js';

test('compat: modalidades e universos vêm de src/lotteries/config.js (sem duplicação)', () => {
  assert.deepEqual([...LOTTERY_IDS].sort(), Object.keys(LOTTERIES).sort());
  for (const id of LOTTERY_IDS) { const r = resultRules(id); assert.equal(r.draw, LOTTERIES[id].draw); assert.equal(r.minNumber, LOTTERIES[id].minNumber); assert.equal(r.maxNumber, LOTTERIES[id].maxNumber); }
  assert.equal(typeof RESULT_VALIDATORS.megasena, 'function');
});

test('compat: sorteios SINTÉTICOS do laboratório da Fase 2 passam pelo pipeline da Fase 3a', () => {
  const fns = Object.keys(lab);
  assert.ok(fns.includes('drawStream'), 'drawStream exportado pela Fase 2');
  for (const id of LOTTERY_IDS) {
    let contest = 0;
    for (const draw of lab.drawStream({ lottery: id, seed: 20260101, draws: 25 })) {
      contest++;
      const numbers = Array.from(draw);
      const raw = JSON.stringify({ lottery: id, contest, drawDate: '2026-01-01', numbers });
      const r = normalizeRaw(env(raw));
      assert.equal(r.status, 'accepted', `${id} #${contest}`);
      assert.ok(RESULT_VALIDATORS[id](r.record).valid);
    }
    assert.equal(contest, 25);
  }
});

test('compat: JCS coincide com JSON.stringify em objetos simples já ordenados', () => {
  const o = { a: 1, b: [1, 2, 'x'], c: { d: null } };
  assert.equal(canonicalize(o), JSON.stringify(o));
});
