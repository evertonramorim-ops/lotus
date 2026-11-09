/**
 * Armazenamento local append-only (fora do Git) para a importação real.
 * - grava com flag 'wx' (nunca sobrescreve); arquivo já existente só é aceito se byte-idêntico;
 * - ledger de manifestos persistente em JSONL, revalidado por ManifestLedger a cada carga.
 * @module historical/store
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, openSync, closeSync, fstatSync, lstatSync, realpathSync, readlinkSync, writeSync, readdirSync, constants as FS } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { ManifestLedger } from '../integrity/manifest.js';

export function writeOnce(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  if (existsSync(path)) {
    if (Buffer.compare(readFileSync(path), buf) === 0) return 'EXISTING_IDENTICAL';
    throw new Error(`recusa de sobrescrita: ${path} já existe com conteúdo diferente`);
  }
  writeFileSync(path, buf, { flag: 'wx' });
  return 'WRITTEN';
}
export const writeJsonOnce = (path, obj) => writeOnce(path, JSON.stringify(obj, null, 2) + '\n');

/**
 * Ledger persistente: cada manifesto aceito vira uma linha; a carga revalida a cadeia inteira.
 * Com `{ root, rel }` (scripts da Fase 3b.2), leitura e acréscimo passam pelo confinamento real (readConfined/appendConfined).
 */
export class FileLedger {
  constructor(path, { root = null, rel = null } = {}) {
    this.root = root; this.rel = rel; this.path = root ? null : resolve(path); this.ledger = new ManifestLedger();
    const text = root ? (existsConfined(root, rel) ? readConfined(root, rel).toString('utf8') : null) : existsSync(this.path) ? readFileSync(this.path, 'utf8') : null;
    if (text !== null) for (const [i, line] of text.split('\n').filter(Boolean).entries()) {
      const r = this.ledger.submit(JSON.parse(line));
      if (!r.accepted) throw new Error(`ledger corrompido na linha ${i + 1}: ${r.code}`);
    }
  }
  latest(id) { return this.ledger.latest(id); }
  submit(m) {
    const r = this.ledger.submit(m);
    if (r.accepted) {
      if (this.root) appendConfined(this.root, this.rel, JSON.stringify(m) + '\n');
      else { mkdirSync(dirname(this.path), { recursive: true }); appendFileSync(this.path, JSON.stringify(m) + '\n'); }
    }
    return r;
  }
  history(id) { return this.ledger.history.get(id) ?? []; }
}
export const privatePaths = root => ({
  root, raw: join(root, 'raw'), runs: join(root, 'runs'), ledger: join(root, 'ledger', 'manifests.jsonl'),
  json: join(root, 'json'), requestLog: join(root, 'request_log.jsonl'), reconciliation: join(root, 'reconciliation'),
});

/**
 * Caminho RELATIVO seguro (vindo de plano ou log): sem absoluto, "..", ".", "\\", NUL, ":" ou segmento vazio;
 * opcionalmente obrigado a começar por `prefix`. Função pura (não toca o disco).
 * @returns {{ok:true, path:string}|{ok:false, reason:string}}
 */
export function safeRelativePath(rel, { prefix = '' } = {}) {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) return { ok: false, reason: 'CAMINHO_INVALIDO' };
  if (rel.includes('\0') || rel.includes('\\') || rel.includes(':')) return { ok: false, reason: 'CARACTERE_PROIBIDO_NO_CAMINHO' };
  if (rel.startsWith('/') || isAbsolute(rel)) return { ok: false, reason: 'CAMINHO_ABSOLUTO' };
  const segs = rel.split('/');
  if (segs.some(x => x === '' || x === '.' || x === '..')) return { ok: false, reason: 'SEGMENTO_PROIBIDO_NO_CAMINHO' };
  if (prefix && !rel.startsWith(prefix)) return { ok: false, reason: 'FORA_DO_SUBDIRETORIO_PREVISTO' };
  return { ok: true, path: rel };
}
/** Junta `root` + caminho relativo seguro e confirma (após resolve) que o resultado continua DENTRO de `root`. */
export function safeJoin(root, rel, opt) {
  const r = safeRelativePath(rel, opt); if (!r.ok) throw new Error(`caminho recusado (${r.reason}): ${JSON.stringify(rel)}`);
  const base = resolve(root); const full = resolve(base, r.path); const d = relative(base, full);
  if (!d || d.startsWith('..') || isAbsolute(d) || d.split(sep).includes('..')) throw new Error(`caminho recusado (FORA_DA_RAIZ): ${JSON.stringify(rel)}`);
  return full;
}

/* ---------- confinamento REAL no sistema de arquivos (correção final 3b.2, §4) ----------
 * safeRelativePath/safeJoin são LEXICAIS: não impedem que um componente dentro da raiz seja link simbólico para fora.
 * As funções abaixo, usadas por TODOS os caminhos de leitura/escrita dos scripts da Fase 3b.2:
 * 1. validam o caminho relativo (safeRelativePath) e resolvem a raiz por realpath UMA vez (a raiz é escolha do operador);
 * 2. percorrem cada componente intermediário com lstat: link simbólico → LINK_SIMBOLICO_NO_CAMINHO; não-diretório → recusa;
 *    diretórios criados um a um (mkdir não recursivo) e reconferidos com lstat;
 * 3. arquivo final: lstat (link simbólico → LINK_SIMBOLICO_NO_ARQUIVO; não regular → ARQUIVO_NAO_REGULAR) e abertura com
 *    O_NOFOLLOW (quando o SO oferece); escrita nova com O_CREAT|O_EXCL (nunca segue link, nunca sobrescreve);
 * 4. após abrir, fstat confere tipo e (leitura) dev/ino iguais ao lstat; no Linux, /proc/self/fd/N confirma que o
 *    descritor aberto está DENTRO da raiz real (fecha a janela de corrida entre validação e abertura para o arquivo lido).
 * LIMITAÇÕES (não é confinamento absoluto): sem openat/O_BENEATH no Node, um processo local com escrita na raiz que troque
 * um diretório intermediário por link ENTRE a verificação e o open ainda tem uma janela; no Linux ela é DETECTADA após o
 * open (/proc), e a operação falha (na escrita, o arquivo novo pode já ter sido criado fora — detectado e reportado, não
 * desfeito). Fora do Linux (sem /proc) e sem O_NOFOLLOW (Windows), restam só as verificações lstat. A raiz informada
 * pelo operador (--private, --from-3b1, --extra-json, --out) é confiável por definição. */
export class ConfinementError extends Error { constructor(code, rel, detail = {}) { super(`caminho recusado (${code}): ${JSON.stringify(rel)}`); this.name = 'ConfinementError'; this.code = code; this.rel = rel; this.detail = detail; } }
const O_NOFOLLOW = FS.O_NOFOLLOW ?? 0;
const HAS_PROC_FD = (() => { try { return lstatSync('/proc/self/fd').isDirectory(); } catch { return false; } })();
/** Capacidades efetivas do confinamento nesta plataforma (para documentação/relatório). */
export const CONFINEMENT_CAPABILITIES = Object.freeze({ lstatComponents: true, oNoFollow: O_NOFOLLOW !== 0, procFdCheck: HAS_PROC_FD, platform: process.platform });

function realBase(root) {
  let b; try { b = realpathSync(resolve(root)); } catch (e) { throw new ConfinementError('RAIZ_INEXISTENTE', String(root), { errno: e.code }); }
  if (!lstatSync(b).isDirectory()) throw new ConfinementError('RAIZ_NAO_DIRETORIO', String(root));
  return b;
}
const within = (base, p) => p === base || p.startsWith(base.endsWith(sep) ? base : base + sep);
function fdCheck(fd, base, rel) {
  if (!HAS_PROC_FD) return;
  let real; try { real = readlinkSync(`/proc/self/fd/${fd}`); } catch { return; }
  if (!within(base, real)) throw new ConfinementError('DESCRITOR_FORA_DA_RAIZ', rel);
}
/**
 * Resolve `rel` dentro de `root` conferindo cada componente intermediário no disco.
 * @param {{prefix?:string, createDirs?:boolean, allowMissing?:boolean}} [opt]
 * @returns {{base:string, full:string, rel:string, missing:boolean}} missing = algum intermediário não existe (allowMissing)
 */
export function confinedPath(root, rel, { prefix = '', createDirs = false, allowMissing = false } = {}) {
  const r = safeRelativePath(rel, { prefix }); if (!r.ok) throw new ConfinementError(r.reason, rel);
  const base = realBase(root); const segs = r.path.split('/'); let cur = base;
  for (const seg of segs.slice(0, -1)) {
    cur = join(cur, seg); let st;
    try { st = lstatSync(cur); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (!createDirs) { if (allowMissing) return { base, full: join(base, ...segs), rel: r.path, missing: true }; throw new ConfinementError('CAMINHO_INEXISTENTE', rel); }
      try { mkdirSync(cur); } catch (e2) { if (e2.code !== 'EEXIST') throw e2; }
      st = lstatSync(cur);
    }
    if (st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_CAMINHO', rel, { component: relative(base, cur) });
    if (!st.isDirectory()) throw new ConfinementError('COMPONENTE_NAO_DIRETORIO', rel, { component: relative(base, cur) });
  }
  const full = join(cur, segs[segs.length - 1]);
  if (!within(base, full)) throw new ConfinementError('FORA_DA_RAIZ', rel);
  return { base, full, rel: r.path, missing: false };
}
const lstatOrNull = p => { try { return lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
/** Existe? (link simbólico em qualquer componente ou no arquivo final → ConfinementError, nunca "false" silencioso). */
export function existsConfined(root, rel, opt = {}) {
  const c = confinedPath(root, rel, { ...opt, allowMissing: true }); if (c.missing) return false;
  const st = lstatOrNull(c.full); if (!st) return false;
  if (st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel);
  return true;
}
/** Lê um arquivo REGULAR confinado (sem seguir links). @returns {Buffer} */
export function readConfined(root, rel, opt = {}) {
  const c = confinedPath(root, rel, opt); const st = lstatOrNull(c.full);
  if (!st) throw new ConfinementError('ARQUIVO_INEXISTENTE', rel);
  if (st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel);
  if (!st.isFile()) throw new ConfinementError('ARQUIVO_NAO_REGULAR', rel);
  let fd; try { fd = openSync(c.full, FS.O_RDONLY | O_NOFOLLOW); } catch (e) { if (e.code === 'ELOOP') throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel); throw e; }
  try {
    const f = fstatSync(fd);
    if (!f.isFile() || f.ino !== st.ino || f.dev !== st.dev) throw new ConfinementError('ARQUIVO_TROCADO_DURANTE_ABERTURA', rel);
    fdCheck(fd, c.base, rel);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
/** Lista um diretório confinado (todos os componentes, inclusive o último, devem ser diretórios reais). */
export function listDirConfined(root, rel, opt = {}) {
  const c = confinedPath(root, rel, opt); const st = lstatOrNull(c.full);
  if (!st) throw new ConfinementError('DIRETORIO_INEXISTENTE', rel);
  if (st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_CAMINHO', rel);
  if (!st.isDirectory()) throw new ConfinementError('COMPONENTE_NAO_DIRETORIO', rel);
  return readdirSync(c.full);
}
function writeAllFd(fd, buf) { let off = 0; while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off); }
/** Gravação única confinada: nunca sobrescreve; existente só é aceito se byte-idêntico; nunca segue link. */
export function writeOnceConfined(root, rel, data, opt = {}) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const c = confinedPath(root, rel, { ...opt, createDirs: true }); const st = lstatOrNull(c.full);
  if (st) {
    if (st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel);
    if (Buffer.compare(readConfined(root, rel, opt), buf) === 0) return 'EXISTING_IDENTICAL';
    throw new Error(`recusa de sobrescrita: ${c.rel} já existe com conteúdo diferente`);
  }
  let fd; try { fd = openSync(c.full, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | O_NOFOLLOW, 0o644); } catch (e) { if (e.code === 'EEXIST' || e.code === 'ELOOP') throw new ConfinementError('ARQUIVO_SURGIU_DURANTE_ESCRITA', rel); throw e; }
  try { if (!fstatSync(fd).isFile()) throw new ConfinementError('ARQUIVO_NAO_REGULAR', rel); fdCheck(fd, c.base, rel); writeAllFd(fd, buf); } finally { closeSync(fd); }
  return 'WRITTEN';
}
export const writeJsonOnceConfined = (root, rel, obj, opt) => writeOnceConfined(root, rel, JSON.stringify(obj, null, 2) + '\n', opt);
/** Acréscimo confinado (ledger, request_log): arquivo final regular, sem link; criado se ausente. */
export function appendConfined(root, rel, data, opt = {}) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const c = confinedPath(root, rel, { ...opt, createDirs: true }); const st = lstatOrNull(c.full);
  if (st && st.isSymbolicLink()) throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel);
  if (st && !st.isFile()) throw new ConfinementError('ARQUIVO_NAO_REGULAR', rel);
  let fd; try { fd = openSync(c.full, FS.O_WRONLY | FS.O_APPEND | FS.O_CREAT | O_NOFOLLOW, 0o644); } catch (e) { if (e.code === 'ELOOP') throw new ConfinementError('LINK_SIMBOLICO_NO_ARQUIVO', rel); throw e; }
  try { const f = fstatSync(fd); if (!f.isFile() || (st && (f.ino !== st.ino || f.dev !== st.dev))) throw new ConfinementError('ARQUIVO_TROCADO_DURANTE_ABERTURA', rel); fdCheck(fd, c.base, rel); writeAllFd(fd, buf); } finally { closeSync(fd); }
}
