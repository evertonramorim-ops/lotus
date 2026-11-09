/**
 * SYNTHETIC_DATA — gerador DETERMINÍSTICO de XLSX/ZIP sintéticos para testes da Fase 3b.2.
 * ZIP próprio (sem dependências): data DOS fixa, ordem fixa, método STORED por padrão (bytes estáveis
 * entre versões de zlib); DEFLATE opcional. Nenhum dado real da CAIXA é usado: todos os valores vêm
 * de um PRNG com semente fixa.
 */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../src/xlsx/zip.js';
import { getXlsxAdapter } from '../../src/historical/adapters/index.js';
import { periodFor } from '../../src/historical/tier-rules.js';

const enc = s => new TextEncoder().encode(s);
const u16 = v => [v & 255, (v >>> 8) & 255];
const u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

/**
 * @param {{name:string, data:Uint8Array|string, method?:0|8, nameBytes?:Uint8Array, flags?:number, crcOverride?:number, sizeOverride?:number}[]} files
 * @param {{trailing?:Uint8Array, comment?:string, cdNameOverride?:Record<number,string>}} [opt]
 */
export function buildZip(files, opt = {}) {
  const chunks = []; const cd = []; let off = 0;
  for (const [i, f] of files.entries()) {
    const data = typeof f.data === 'string' ? enc(f.data) : f.data;
    const method = f.method ?? 0;
    const comp = method === 8 ? new Uint8Array(deflateRawSync(data, { level: 9 })) : data;
    const nameB = f.nameBytes ?? enc(f.name);
    const crc = f.crcOverride ?? crc32(data);
    const usize = f.sizeOverride ?? data.length;
    const flags = (f.flags ?? 0) | 0x800;
    const lh = [...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(comp.length), ...u32(usize), ...u16(nameB.length), ...u16(0)];
    chunks.push(new Uint8Array(lh), nameB, comp);
    const cdName = opt.cdNameOverride && opt.cdNameOverride[i] !== undefined ? enc(opt.cdNameOverride[i]) : nameB;
    cd.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(comp.length), ...u32(usize), ...u16(cdName.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), cdName);
    off += lh.length + nameB.length + comp.length;
  }
  const cdStart = off; const cdLen = cd.reduce((s, c) => s + c.length, 0);
  const comment = enc(opt.comment ?? '');
  const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdLen), ...u32(cdStart), ...u16(comment.length)]);
  const parts = [...chunks, ...cd, eocd, comment, ...(opt.trailing ? [opt.trailing] : [])];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/**
 * Monta XLSX sintético. Células: number|string|null|{t,v}|{f, v} (fórmula com valor em cache).
 * @param {{sheetName:string, header:string[], rows:any[][], prefix?:string, implicitRefs?:boolean,
 *   strings?:'shared'|'inline'|'str', extraParts?:{name:string,data:string|Uint8Array,contentType?:string}[], date1904?:boolean,
 *   extraSheets?:string[], method?:0|8, workbookRelsExtra?:string, sheetXmlPrefix?:string}} o
 */
export function buildXlsx(o) {
  const P = o.prefix ? `${o.prefix}:` : ''; const ns = o.prefix ? `xmlns:${o.prefix}` : 'xmlns';
  const mode = o.strings ?? 'shared'; const sst = []; const sidx = new Map();
  const si = t => { if (!sidx.has(t)) { sidx.set(t, sst.length); sst.push(t); } return sidx.get(t); };
  const cell = (v, r, c, isHeader) => {
    const ref = o.implicitRefs ? '' : ` r="${colName(c)}${r}"`;
    if (v === null || v === undefined) return o.implicitRefs ? `<${P}c t="str"${ref}><${P}v></${P}v></${P}c>` : '';
    if (typeof v === 'number') return `<${P}c${ref} t="n"><${P}v>${v}</${P}v></${P}c>`;
    if (typeof v === 'object') return v.f ? `<${P}c${ref}${v.t ? ` t="${v.t}"` : ''}><${P}f>${esc(v.f)}</${P}f><${P}v>${esc(v.v)}</${P}v></${P}c>` : `<${P}c${ref} t="${v.t}"><${P}v>${esc(v.v)}</${P}v></${P}c>`;
    const m = isHeader && mode !== 'inline' ? 'shared' : mode;
    if (m === 'shared') return `<${P}c${ref} t="s"><${P}v>${si(v)}</${P}v></${P}c>`;
    if (m === 'inline') return `<${P}c${ref} t="inlineStr"><${P}is><${P}t>${esc(v)}</${P}t></${P}is></${P}c>`;
    return `<${P}c${ref} t="str"><${P}v>${esc(v)}</${P}v></${P}c>`;
  };
  const rowsXml = [o.header, ...o.rows].map((row, i) => `<${P}row${o.implicitRefs && i > 0 ? '' : ` r="${i + 1}"`}>${row.map((v, c) => cell(v, i + 1, c, i === 0)).join('')}</${P}row>`).join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${o.sheetXmlPrefix ?? ''}<${P}worksheet ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><${P}dimension ref="A1"/><${P}sheetData>${rowsXml}</${P}sheetData></${P}worksheet>`;
  const allSheets = [o.sheetName, ...(o.extraSheets ?? [])];
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${P}workbook ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${o.date1904 ? `<${P}workbookPr date1904="1"/>` : ''}<${P}sheets>${allSheets.map((n, i) => `<${P}sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</${P}sheets></${P}workbook>`;
  const emptySheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`;
  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${P}sst ${ns}="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map(t => `<${P}si><${P}t xml:space="preserve">${esc(t)}</${P}t></${P}si>`).join('')}</${P}sst>`;
  const SH = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${allSheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SH}"/>`).join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${(o.extraParts ?? []).filter(p => p.contentType).map(p => `<Override PartName="/${p.name}" ContentType="${p.contentType}"/>`).join('')}</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${allSheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${o.workbookRelsExtra ?? ''}</Relationships>`;
  const files = [
    { name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }, ...allSheets.slice(1).map((_, i) => ({ name: `xl/worksheets/sheet${i + 2}.xml`, data: emptySheet })),
    { name: 'xl/sharedStrings.xml', data: sstXml }, ...(o.extraParts ?? []).map(p => ({ name: p.name, data: p.data })),
  ].map(f => ({ ...f, method: o.method ?? 0 }));
  return buildZip(files);
}

/** PRNG determinístico (mulberry32). */
export function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const brl = cents => { const s = String(cents).padStart(3, '0'); const int = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return `R$${int},${s.slice(-2)}`; };
const pad2 = n => String(n).padStart(2, '0');
export const brDate = d => `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;

/**
 * Linhas SYNTHETIC_DATA no formato do adaptador da modalidade (valores inventados, sem relação com a CAIXA).
 * @returns {{header:string[], rows:any[][], spec:object}}
 */
export function syntheticRows(lottery, { count = 12, seed = 1, startContest = 1, startDate = Date.UTC(2001, 0, 6), stepDays = 3 } = {}) {
  const spec = getXlsxAdapter(lottery); const rnd = prng(seed);
  const cfg = { megasena: [6, 1, 60], lotofacil: [15, 1, 25], quina: [5, 1, 80], lotomania: [20, 0, 99] }[lottery];
  const header = [...spec.columnOrder]; const rows = [];
  for (let k = 0; k < count; k++) {
    const contest = startContest + k; const per = periodFor(lottery, contest);
    const nums = new Set(); while (nums.size < cfg[0]) nums.add(cfg[1] + Math.floor(rnd() * (cfg[2] - cfg[1] + 1)));
    const balls = [...nums].sort((a, b) => a - b);
    const date = new Date(startDate + k * stepDays * 86400000);
    const row = header.map(h => {
      if (h === 'Concurso') return contest;
      if (/^Data/.test(h)) return brDate(date);
      const b = /^Bola(\d+)$/.exec(h); if (b) return { t: 'n', v: pad2(balls[Number(b[1]) - 1]) };
      const g = /^Ganhadores (\d+) acertos$|^Ganhadores Nenhum Número$/.exec(h);
      const rr = /^Rateio (\d+) acertos$|^Rateio Nenhum Número$/.exec(h);
      const hits = g ? (g[1] === undefined ? 0 : Number(g[1])) : rr ? (rr[1] === undefined ? 0 : Number(rr[1])) : null;
      if (hits !== null && per && !per.presentTiers.includes(hits)) return { t: 'n', v: '-' };
      if (g) return Math.floor(rnd() * 50);
      if (rr) return brl(100 + Math.floor(rnd() * 9999900));
      if (h === 'Cidade / UF') return '';
      if (/^observa/i.test(h)) return '';
      return brl(Math.floor(rnd() * 1e9)); // econômicos
    });
    rows.push(row);
  }
  return { header, rows, spec };
}
export const SHEET_NAMES = { megasena: 'MEGA SENA', lotofacil: 'LOTOFÁCIL', quina: 'QUINA', lotomania: 'LOTOMANIA' };
/** XLSX sintético "real-like" da modalidade (prefixo x:, refs implícitas, t="str"), igual ao formato observado. */
export function syntheticWorkbook(lottery, opt = {}) {
  const { header, rows } = syntheticRows(lottery, opt);
  const mutated = opt.mutate ? opt.mutate({ header: [...header], rows: rows.map(r => [...r]) }) : { header, rows };
  return buildXlsx({ sheetName: opt.sheetName ?? SHEET_NAMES[lottery], header: mutated.header, rows: mutated.rows, prefix: opt.prefix ?? 'x', implicitRefs: opt.implicitRefs ?? true, strings: opt.strings ?? 'str', method: opt.method ?? 0, extraParts: opt.extraParts, extraSheets: opt.extraSheets });
}
export const SYNTH_META = (lottery, name = 'fixture') => ({ collectionRunId: 'SYNTHETIC_DATA-run', url: `https://synthetic.invalid/SYNTHETIC_DATA/${lottery}/${name}.xlsx`, httpStatus: 200, contentType: 'application/xlsx', originalFileName: `SYNTHETIC_DATA_${name}.xlsx`, collectedAt: '2026-01-01T00:00:00Z', sourceType: 'SYNTHETIC_DATA' });
