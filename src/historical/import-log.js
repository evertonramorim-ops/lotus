/**
 * Plano de importação a partir do request_log.jsonl da Fase 3b.1 (extraído de scripts/importar-historico-fase3b2.mjs
 * para ser testável). Função pura: não lê disco nem rede. Nada do log é confiado sem validação:
 * - linha não JSON, URL inválida, modalidade desconhecida, caminho inseguro (safeRelativePath com prefixo `raw/`, sem
 *   "basename" de caminhos estranhos), SHA-256 registrado malformado ou `utc` inválido → linha REJEITADA com origem,
 *   número da linha e motivo; as demais linhas continuam sendo processadas (antes: JSON.parse/toISOString lançavam e
 *   abortavam o arquivo inteiro; `join(src, d.file)` aceitava "raw/../../…").
 * @module historical/import-log
 */
import { safeRelativePath } from './store.js';
import { parseLogTimestamp } from './timestamps.js';

const MODALIDADE = Object.freeze({ 'Mega-Sena': 'megasena', 'Lotofácil': 'lotofacil', Quina: 'quina', Lotomania: 'lotomania' });
const DOWNLOAD = /\/api\/resultados\/download\?modalidade=/;
const SHA_RE = /^[0-9a-f]{64}$/;

/**
 * @param {string} logText conteúdo do request_log.jsonl da Fase 3b.1
 * @returns {{items:{line:number, lottery:string, relFile:string, url:string, method:any, httpStatus:number, sha256:string, headers:object, collectedAt:string, utcLiteral:string}[],
 *   rejected:{origin:'FASE3B1', line:number, reason:string, utcLiteral?:any}[]}}
 */
export function planImportFromLog(logText) {
  const items = []; const rejected = [];
  const lines = String(logText).split('\n');
  lines.forEach((l, i) => {
    const n = i + 1; if (!l.trim()) return;
    const rej = (reason, extra = {}) => rejected.push({ origin: 'FASE3B1', line: n, reason, ...extra });
    let d; try { d = JSON.parse(l); } catch { return rej('LINHA_NAO_JSON'); }
    if (!d || typeof d !== 'object' || typeof d.url !== 'string' || !DOWNLOAD.test(d.url) || d.status !== 200) return; // não é download XLSX bem-sucedido
    let u; try { u = new URL(d.url); } catch { return rej('URL_INVALIDA'); }
    const lottery = MODALIDADE[u.searchParams.get('modalidade')];
    if (!lottery) return rej('MODALIDADE_DESCONHECIDA');
    const rel = safeRelativePath(d.file, { prefix: 'raw/' });
    if (!rel.ok) return rej(rel.reason);
    if (typeof d.sha256 !== 'string' || !SHA_RE.test(d.sha256)) return rej('SHA256_REGISTRADO_INVALIDO');
    const ts = parseLogTimestamp(d.utc);
    if (!ts.ok) return rej(ts.reason, { utcLiteral: ts.literal });
    const headers = d.headers && typeof d.headers === 'object' && !Array.isArray(d.headers) ? d.headers : {};
    items.push({ line: n, lottery, relFile: rel.path, url: d.url, method: d.method, httpStatus: d.status, sha256: d.sha256, headers, collectedAt: ts.iso, utcLiteral: ts.literal });
  });
  return { items, rejected };
}
