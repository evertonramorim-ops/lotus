/**
 * Correções para múltiplas comparações (valores-p ajustados, monótonos), como p.adjust do R.
 *  Holm (1979): controla FWER. adj_(i) = max_{j≤i} min(1, (m−j+1)·p_(j)).
 *  Benjamini–Hochberg (1995): controla FDR (independência/PRDS). adj_(i) = min_{j≥i} min(1, m·p_(j)/j).
 * @module stats/multiple
 */
function check(p) { if (!Array.isArray(p) || p.length === 0 || p.some(x => typeof x !== 'number' || !(x >= 0 && x <= 1))) throw new RangeError('valores-p devem estar em [0,1]'); }
const order = p => p.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[1]);

/** @param {number[]} p @returns {number[]} */
export function holm(p) { check(p); const m = p.length, o = order(p), out = new Array(m); let run = 0; o.forEach((idx, j) => { run = Math.max(run, Math.min(1, (m - j) * p[idx])); out[idx] = run; }); return out; }
/** @param {number[]} p @returns {number[]} */
export function benjaminiHochberg(p) { check(p); const m = p.length, o = order(p), out = new Array(m); let run = 1; for (let j = m - 1; j >= 0; j--) { const idx = o[j]; run = Math.min(run, Math.min(1, (m * p[idx]) / (j + 1))); out[idx] = run; } return out; }

/**
 * Família de hipóteses documentada: todos os testes realizados entram (sem seleção).
 * @param {{name:string, hypotheses:{id:string,p:number}[], kind:'exploratory'|'confirmatory', alpha:number}} f
 */
export function adjustFamily({ name, hypotheses, kind, alpha }) {
  if (!['exploratory', 'confirmatory'].includes(kind)) throw new RangeError('kind deve ser exploratory|confirmatory');
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha deve estar em (0,1)');
  const p = hypotheses.map(h => h.p), h = holm(p), b = benjaminiHochberg(p);
  return { family: name, kind, alpha, m: p.length, criteria: { unadjusted: 'p ≤ alpha', holm: 'p_holm ≤ alpha (FWER)', bh: 'p_bh ≤ alpha (FDR)' },
    results: hypotheses.map((x, i) => ({ id: x.id, p: x.p, p_holm: h[i], p_bh: b[i], reject_unadjusted: x.p <= alpha, reject_holm: h[i] <= alpha, reject_bh: b[i] <= alpha })),
    rejections: { unadjusted: p.filter(x => x <= alpha).length, holm: h.filter(x => x <= alpha).length, bh: b.filter(x => x <= alpha).length } };
}
