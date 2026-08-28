/**
 * Document ingestion. Reads an uploaded file off disk and turns it into
 * policy or regulation records. Ported from the prototype's `ingest()`,
 * `csvToObjs()` and `splitRequirements()`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import {
  DocSource,
  Framework,
  FRAMEWORKS,
  PolicyScope,
} from '@policy-prism/shared';
import { ApiError } from '../utils/http';

/* ------------------------------------------------------------------ *
 * Raw text
 * ------------------------------------------------------------------ */

/**
 * Reads every worksheet in a workbook into row objects, using each sheet's
 * first row as headers. A policy library exported from Excel usually has one
 * sheet per department, so all of them are read rather than just the first.
 */
export async function readWorkbookRows(filePath: string): Promise<Array<Record<string, string>>> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.default.Workbook();
  await wb.xlsx.readFile(filePath);

  const out: Array<Record<string, string>> = [];
  wb.eachSheet((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, col) => {
      headers[col] = String(cell.value ?? '').trim();
    });
    if (!headers.filter(Boolean).length) return;

    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const obj: Record<string, string> = {};
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (!key) return;
        const v = cell.value;
        obj[key] =
          v && typeof v === 'object' && 'text' in (v as unknown as Record<string, unknown>)
            ? String((v as unknown as { text: unknown }).text ?? '')
            : v instanceof Date
              ? v.toISOString().slice(0, 10)
              : String(v ?? '');
      });
      if (Object.values(obj).some((x) => String(x).trim())) out.push(obj);
    });
  });
  return out;
}

/** Extracts the text layer of a PDF. Scanned images have none - see below. */
export async function readPdfText(filePath: string): Promise<string> {
  const fsMod = await import('node:fs');
  const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
  const buf = fsMod.readFileSync(filePath);
  const parsed = await pdfParse(buf);
  const text = String(parsed.text ?? '').trim();
  if (text.length < 40) {
    throw new Error(
      'No text layer found in this PDF. It is probably a scan - run OCR on it, or upload a DOCX or CSV instead.',
    );
  }
  return text;
}

export async function readFileText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  }
  return fs.readFile(filePath, 'utf8');
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

/** RFC-4180-ish CSV reader that handles quoted fields and escaped quotes. */
/**
 * Picks the delimiter from the header line by counting candidates outside
 * quotes. European Excel writes semicolons; .tsv files use tabs. Assuming a
 * comma silently collapses those into one column and drops every row.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const outsideQuotes = firstLine.replace(/"[^"]*"/g, '');
  const counts: Array<[string, number]> = [
    [',', (outsideQuotes.match(/,/g) ?? []).length],
    [';', (outsideQuotes.match(/;/g) ?? []).length],
    ['\t', (outsideQuotes.match(/\t/g) ?? []).length],
    ['|', (outsideQuotes.match(/\|/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCSV(t: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(t);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') {
      cur += c;
    }
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

export function csvToObjects(text: string): Array<Record<string, string>> | null {
  text = text.replace(/^\uFEFF/, '');
  const rows = parseCSV(text);
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => {
      o[h] = r[i] || '';
    });
    return o;
  });
}

/** Lowercase, strip non-letters from keys so "Policy Code" == "policycode". */
function normalizeKeys(o: Record<string, unknown>): Record<string, string> {
  const g: Record<string, string> = {};
  Object.keys(o).forEach((k) => {
    g[k.toLowerCase().replace(/[^a-z]/g, '')] = String(o[k] ?? '');
  });
  return g;
}

/**
 * Last resort when no column matched: the longest cell in the row is
 * overwhelmingly likely to be the policy body. Better than dropping the row and
 * telling the user nothing was found.
 */
function longestCell(g: Record<string, string>): string {
  let best = '';
  Object.values(g).forEach((v) => {
    const s = String(v ?? '').trim();
    if (s.length > best.length) best = s;
  });
  return best.length > 40 ? best : '';
}

function pick(g: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    if (g[k]) return String(g[k]).trim();
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * Requirement splitting from free text
 * ------------------------------------------------------------------ */

const HEAD_RE = /^(\u00a7|Sec\b|Section\b|Rule\b|OAC\b|\d{2,3}\s*CFR|\d+\.\d+|\d+\)\s|\(\w+\)\s*\u00a7)/i;
const CITE_RE =
  /^\s*((?:\u00a7+\s*|Sec(?:tion)?\.?\s+|Rule\s+|OAC\s+|\d{2,3}\s*CFR\s*)?[0-9][0-9A-Za-z.\u2010-\u2015-]*(?:\([0-9a-zA-Z]+\))*)\s*[.\u2014:\-\u2013]?\s*(.{0,140})$/;

export interface SplitRequirement {
  citation: string;
  title: string;
  text: string;
}

/**
 * Break a regulation document into individual requirements by looking for
 * citation-shaped headings. Falls back to paragraph splitting.
 */
export function splitRequirements(text: string): SplitRequirement[] {
  const lines = text.split(/\r?\n/);
  const blocks: Array<{ head: string; body: string[] }> = [];
  let cur: { head: string; body: string[] } | null = null;

  lines.forEach((l) => {
    const t = l.trim();
    if (t && t.length <= 170 && HEAD_RE.test(t)) {
      if (cur) blocks.push(cur);
      cur = { head: t, body: [] };
    } else if (cur) {
      cur.body.push(l);
    }
  });
  if (cur) blocks.push(cur);

  let out: SplitRequirement[] = blocks
    .map((b) => {
      const m = b.head.match(CITE_RE) || [];
      const citation = String(m[1] || b.head.slice(0, 26)).replace(/\s+/g, ' ').trim();
      const body = b.body.join(' ').replace(/\s+/g, ' ').trim();
      let title = String(m[2] || '').trim();
      if (!title) title = body.slice(0, 70) + (body.length > 70 ? '\u2026' : '');
      return { citation, title, text: `${title}. ${body}`.trim() };
    })
    .filter((b) => b.text.length > 60);

  if (out.length < 2) {
    out = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter((p) => p.length > 90)
      .map((p, i) => ({
        citation: `REQ-${String(i + 1).padStart(3, '0')}`,
        title: p.slice(0, 70) + (p.length > 70 ? '\u2026' : ''),
        text: p,
      }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Record shapes
 * ------------------------------------------------------------------ */

export interface IngestedPolicy {
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string;
  scope: PolicyScope;
  text: string;
  fileName: string;
  source: DocSource;
}

export interface IngestedRegulation {
  framework: Framework;
  citation: string;
  title: string;
  requirementText: string;
  applicability: string;
  fileName: string;
  source: DocSource;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function asFramework(v: string): Framework {
  const hit = FRAMEWORKS.find((f) => f.toLowerCase() === v.toLowerCase());
  return hit ?? 'Custom';
}

function asScope(v: string): PolicyScope {
  const s = v.toLowerCase();
  if (s.startsWith('operat')) return 'operational';
  if (s.startsWith('govern')) return 'governance';
  return 'regulatory';
}

function rowToPolicy(g: Record<string, string>, fileName: string): IngestedPolicy {
  return {
    code: pick(g, ['code', 'id', 'policycode', 'policyid', 'policynumber', 'policyno', 'number', 'ref']),
    title: pick(g, ['title', 'name', 'policy', 'policyname', 'policytitle', 'subject', 'heading']) || 'Untitled',
    owner: pick(g, ['owner', 'department', 'dept', 'responsible', 'ownerdepartment', 'responsibleparty', 'unit']) || 'Unassigned',
    version: pick(g, ['version', 'ver', 'rev', 'revision']) || '1.0',
    effectiveDate: pick(g, ['effective', 'effectivedate', 'date', 'approved']) || todayISO(),
    scope: asScope(pick(g, ['scope', 'policytype', 'type', 'category'])),
    text:
      pick(g, [
        'text', 'body', 'content', 'policytext', 'policybody', 'policycontent',
        'description', 'statement', 'details', 'detail', 'narrative', 'procedure',
      ]) || longestCell(g),
    fileName,
    source: 'upload',
  };
}

function rowToRegulation(g: Record<string, string>, fileName: string): IngestedRegulation {
  return {
    framework: asFramework(pick(g, ['framework', 'fw', 'source', 'regulation']) || 'Custom'),
    citation: pick(g, ['citation', 'cite', 'id', 'ref', 'section']) || '\u2014',
    title: pick(g, ['title', 'name', 'requirement', 'heading']) || 'Untitled',
    requirementText:
      pick(g, ['text', 'requirement', 'body', 'description', 'content', 'requirementtext', 'standard', 'provision', 'details']),
    applicability: pick(g, ['applies', 'appliesto', 'applicability', 'scope']) || 'always',
    fileName,
    source: 'upload',
  };
}

/* ------------------------------------------------------------------ *
 * Entry points
 * ------------------------------------------------------------------ */

export interface IngestResult<T> {
  found: T[];
  errors: string[];
}

export async function ingestPolicyFile(
  filePath: string,
  originalName: string,
): Promise<IngestResult<IngestedPolicy>> {
  const ext = path.extname(originalName).toLowerCase();
  const errors: string[] = [];
  let found: IngestedPolicy[] = [];

  try {
    const raw = ext === '.pdf' ? await readPdfText(filePath) : ext === '.xlsx' || ext === '.xls' ? '' : await readFileText(filePath);

    if (ext === '.json') {
      const parsed: unknown = JSON.parse(raw);
      const arr = Array.isArray(parsed)
        ? parsed
        : ((parsed as Record<string, unknown>)?.policies as unknown[]) ||
          ((parsed as Record<string, unknown>)?.items as unknown[]) ||
          [];
      found = (arr as Array<Record<string, unknown>>).map((o) =>
        rowToPolicy(normalizeKeys(o), originalName),
      );
    } else if (ext === '.csv' || ext === '.tsv') {
      const rows = csvToObjects(raw) || [];
      found = rows.map((o) => rowToPolicy(normalizeKeys(o), originalName));
    } else if (ext === '.xlsx' || ext === '.xls') {
      const rows = await readWorkbookRows(filePath);
      found = rows.map((o) => rowToPolicy(normalizeKeys(o), originalName));
    } else {
      // A single prose document becomes a single policy.
      const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const first = lines[0] || '';
      found = [
        {
          code: '',
          title: first && first.length < 95 ? first : originalName.replace(/\.[^.]+$/, ''),
          owner: 'Unassigned',
          version: '1.0',
          effectiveDate: todayISO(),
          scope: 'regulatory',
          text: raw.replace(/\s+/g, ' ').trim(),
          fileName: originalName,
          source: 'upload',
        },
      ];
    }
  } catch (err) {
    errors.push(`${originalName} \u2014 ${(err as Error).message}`);
  }

  const usable = found.filter((x) => String(x.text || '').trim().length > 40);
  if (!usable.length && !errors.length) {
    errors.push(`${originalName} \u2014 no readable policy text found (needs at least 40 characters)`);
  }
  return { found: usable, errors };
}

export async function ingestRegulationFile(
  filePath: string,
  originalName: string,
): Promise<IngestResult<IngestedRegulation>> {
  const ext = path.extname(originalName).toLowerCase();
  const errors: string[] = [];
  let found: IngestedRegulation[] = [];

  try {
    const raw = ext === '.pdf' ? await readPdfText(filePath) : ext === '.xlsx' || ext === '.xls' ? '' : await readFileText(filePath);

    if (ext === '.json') {
      const parsed: unknown = JSON.parse(raw);
      const arr = Array.isArray(parsed)
        ? parsed
        : ((parsed as Record<string, unknown>)?.regulations as unknown[]) ||
          ((parsed as Record<string, unknown>)?.items as unknown[]) ||
          [];
      found = (arr as Array<Record<string, unknown>>).map((o) =>
        rowToRegulation(normalizeKeys(o), originalName),
      );
    } else if (ext === '.csv' || ext === '.tsv') {
      const rows = csvToObjects(raw) || [];
      found = rows.map((o) => rowToRegulation(normalizeKeys(o), originalName));
    } else if (ext === '.xlsx' || ext === '.xls') {
      const rows = await readWorkbookRows(filePath);
      found = rows.map((o) => rowToRegulation(normalizeKeys(o), originalName));
    } else {
      found = splitRequirements(raw).map((r) => ({
        framework: 'Custom' as Framework,
        citation: r.citation,
        title: r.title,
        requirementText: r.text,
        applicability: 'always',
        fileName: originalName,
        source: 'upload' as DocSource,
      }));
    }
  } catch (err) {
    errors.push(`${originalName} \u2014 ${(err as Error).message}`);
  }

  const usable = found.filter((x) => String(x.requirementText || '').trim().length > 40);
  if (!usable.length && !errors.length) {
    errors.push(`${originalName} \u2014 no readable requirements found`);
  }
  return { found: usable, errors };
}

export function assertReadable(result: IngestResult<unknown>): void {
  if (!result.found.length) {
    throw ApiError.badRequest(
      result.errors[0] || 'Nothing usable could be read from that file',
      result.errors,
    );
  }
}
