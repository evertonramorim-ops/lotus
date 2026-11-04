/**
 * Erro rastreável do parser XLSX/ZIP: código estável + detalhe + parte interna (quando houver).
 * @module xlsx/errors
 */
export class XlsxError extends Error {
  /** @param {string} code @param {string} message @param {object} [ctx] */
  constructor(code, message, ctx = {}) {
    super(`[${code}] ${message}${ctx.part ? ` (parte: ${ctx.part})` : ''}`);
    this.name = 'XlsxError'; this.code = code; this.ctx = { ...ctx };
  }
}
