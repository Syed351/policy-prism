/**
 * Export writers. Every report is built from a simple tabular shape
 * ({ title, head, rows, widths }) so the same dataset can go out as CSV, a
 * formatted Excel workbook or a paginated PDF.
 */

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PRODUCT_FOOTER } from '@policy-prism/shared';

export type Cell = string | number | null | undefined;

export interface Sheet {
  /** Worksheet / PDF table name. */
  name: string;
  head: string[];
  rows: Cell[][];
  /** Character widths per column, used by Excel and to weight PDF columns. */
  widths: number[];
}

/**
 * Renders a timestamp in the reader's timezone, falling back to UTC and saying
 * so. An unlabelled time on a compliance report is worse than no time.
 */
function formatStamp(d: Date, timeZone?: string): string {
  const zone = timeZone || 'UTC';
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: zone,
      hour12: false,
    }).format(d);
    const abbr =
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'short' })
        .formatToParts(d)
        .find((p) => p.type === 'timeZoneName')?.value ?? zone;
    return `${formatted} ${abbr}`;
  } catch {
    // An unrecognised zone must not break the export.
    return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  }
}

export interface ReportMeta {
  title: string;
  /** IANA zone from the requesting browser, e.g. "Asia/Karachi". */
  timeZone?: string;
  facility: string;
  subtitle?: string;
  generatedBy?: string;
  /** Key/value block printed under the heading. */
  summary?: Array<[string, string]>;
  /** Red callout lines, e.g. unreviewed findings. */
  warnings?: string[];
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

const csvCell = (c: Cell): string => `"${String(c ?? '').replace(/"/g, '""')}"`;

export function toCSV(sheet: Sheet): Buffer {
  const lines = [sheet.head, ...sheet.rows].map((r) => r.map(csvCell).join(','));
  // BOM so Excel opens UTF-8 correctly on Windows.
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
}

/* ------------------------------------------------------------------ *
 * Excel
 * ------------------------------------------------------------------ */

/**
 * Column widths set, header row frozen and filters on - the workbook opens
 * readable with no resizing, which is what the prototype promised.
 */
export async function toXLSX(sheets: Sheet[], meta: ReportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Policy Prism';
  wb.created = new Date();
  wb.title = meta.title;

  sheets.forEach((sheet) => {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));

    ws.columns = sheet.head.map((h, i) => ({
      header: h,
      key: `c${i}`,
      width: sheet.widths[i] ?? 18,
    }));

    sheet.rows.forEach((r) => ws.addRow(r.map((c) => (c === null || c === undefined ? '' : c))));

    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    header.height = 20;
    header.alignment = { vertical: 'middle', wrapText: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E1C26' } };
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (sheet.rows.length) {
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: sheet.rows.length + 1, column: sheet.head.length },
      };
    }

    // Colour the coverage column if this sheet has one.
    const coverageIdx = sheet.head.findIndex((h) => h === 'Coverage');
    if (coverageIdx >= 0) {
      ws.eachRow((row, n) => {
        if (n === 1) return;
        const cell = row.getCell(coverageIdx + 1);
        const v = String(cell.value ?? '');
        const colour =
          v === 'Covered' ? 'FF1B6048' : v === 'Partial' ? 'FF8A5A0B' : v ? 'FF9E3823' : undefined;
        if (colour) cell.font = { color: { argb: colour }, bold: true };
      });
    }

    ws.eachRow((row, n) => {
      if (n === 1) return;
      row.alignment = { vertical: 'top', wrapText: true };
      row.font = { size: 10 };
    });
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

const INK = '#0E1C26';
const INK2 = '#3C4F5A';
const INK3 = '#72838C';
const LINE = '#D5DEE1';
const SEAL = '#1B6048';
const AMBER = '#8A5A0B';
const FLAG = '#9E3823';
const FLAG_BG = '#F7E6E1';
const PANEL2 = '#F5F8F9';

/** Draws a paginated report with a header block, summary and tables. */
export function toPDF(sheets: Sheet[], meta: ReportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      // Wide tables of citations, policies and review notes need the width.
      layout: 'landscape',
      margin: 40,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const M = 40;
    const pageWidth = doc.page.width - M * 2;

    // ---- heading -----------------------------------------------------
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(meta.title, M, 52);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(10).fillColor(INK3).text(meta.facility, M);
    if (meta.subtitle) doc.text(meta.subtitle, M);
    doc.text(
      `Generated ${formatStamp(new Date(), meta.timeZone)}${
        meta.generatedBy ? `  \u00b7  ${meta.generatedBy}` : ''
      }`,
      M,
    );

    doc.moveDown(0.8);
    doc.strokeColor(LINE).lineWidth(1).moveTo(M, doc.y).lineTo(M + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);

    // ---- summary block ------------------------------------------------
    if (meta.summary?.length) {
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Summary', M);
      doc.moveDown(0.4);
      doc.fontSize(9.5);
      meta.summary.forEach(([k, v]) => {
        const y = doc.y;
        doc.font('Helvetica').fillColor(INK3).text(k, M, y, { width: 150 });
        doc.font('Helvetica').fillColor(INK2).text(v, M + 155, y, { width: pageWidth - 155 });
        doc.moveDown(0.15);
      });
      doc.moveDown(0.6);
    }

    // ---- warnings -----------------------------------------------------
    // Each warning gets its own block. The y position is captured before
    // drawing, because fill() moves the cursor - deriving the text position
    // from doc.y afterwards put the text back over the summary above it.
    (meta.warnings ?? []).forEach((w) => {
      doc.font('Helvetica').fontSize(9);
      const textHeight = doc.heightOfString(w, { width: pageWidth - 16 });
      const blockHeight = textHeight + 12;

      // Start a new page rather than run a warning off the bottom.
      if (doc.y + blockHeight > doc.page.height - 40 - 26) {
        doc.addPage();
        doc.y = 52;
      }

      const top = doc.y;
      doc.rect(M, top, pageWidth, blockHeight).fill(FLAG_BG);
      doc.fillColor(FLAG).font('Helvetica').fontSize(9).text(w, M + 8, top + 6, {
        width: pageWidth - 16,
      });

      // Place the cursor below the block explicitly; text() leaves it wherever
      // the last line ended, which is inside the rectangle.
      doc.y = top + blockHeight + 8;
    });

    // ---- tables -------------------------------------------------------
    // Only break to a new page when the current one already has content and
    // the next table would not fit. Unconditionally paging between sheets
    // produced a blank page whenever the previous table happened to end near
    // the bottom, or when a table started a page and then ended it.
    const TOP = 52;
    sheets.forEach((sheet, si) => {
      if (si > 0) {
        const roomForHeaderAndRow = doc.y + 60 < doc.page.height - 40 - 26;
        if (!roomForHeaderAndRow) {
          doc.addPage();
          doc.y = TOP;
        } else {
          doc.moveDown(1.2);
        }
      }
      drawTable(doc, sheet, M, pageWidth);
    });

    // ---- footer on every page ------------------------------------------
    // The footer sits below the bottom margin. PDFKit treats text past the
    // margin as overflow and silently appends a page for it - which is what
    // produced a run of blank pages at the end of every report. Collapsing the
    // bottom margin for the duration tells it the space is intentional.
    const range = doc.bufferedPageRange();
    const savedBottom = doc.page.margins.bottom;

    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0;

      // Inside the writable area, not past it: height - margin - line height.
      const y = doc.page.height - savedBottom - 14;
      doc.font('Helvetica').fontSize(8).fillColor('#8C9BA3');
      doc.text(PRODUCT_FOOTER, M, y, { width: pageWidth - 60, height: 10, lineBreak: false });
      doc.text(`Page ${i + 1} of ${range.count}`, M, y, {
        width: pageWidth,
        height: 10,
        align: 'right',
        lineBreak: false,
      });

      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}

function drawTable(
  doc: PDFKit.PDFDocument,
  sheet: Sheet,
  M: number,
  pageWidth: number,
): void {
  const totalWeight = sheet.widths.reduce((a, b) => a + b, 0) || sheet.head.length;
  const cols = sheet.widths.map((w) => (w / totalWeight) * pageWidth);
  // Leave room for the footer strip: bottom margin plus the footer line.
  const bottom = doc.page.height - 40 - 26;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(sheet.name, M, doc.y);
  doc.moveDown(0.4);

  const drawHeader = () => {
    const y = doc.y;
    const h = 18;
    doc.rect(M, y, pageWidth, h).fill(INK);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
    let x = M;
    sheet.head.forEach((label, i) => {
      doc.text(label, x + 4, y + 5, { width: cols[i] - 8, lineBreak: false, ellipsis: true });
      x += cols[i];
    });
    doc.y = y + h;
  };

  drawHeader();

  doc.font('Helvetica').fontSize(7.5);
  sheet.rows.forEach((row, ri) => {
    const cells = row.map((c) => String(c ?? ''));
    const heights = cells.map((c, i) =>
      doc.heightOfString(c, { width: cols[i] - 8, lineGap: 0 }),
    );
    const rowHeight = Math.max(14, Math.max(...heights) + 7);

    if (doc.y + rowHeight > bottom) {
      doc.addPage();
      doc.y = 52;
      drawHeader();
      doc.font('Helvetica').fontSize(7.5);
    }

    const y = doc.y;
    if (ri % 2 === 1) doc.rect(M, y, pageWidth, rowHeight).fill(PANEL2);

    let x = M;
    cells.forEach((c, i) => {
      const isCoverage = sheet.head[i] === 'Coverage';
      const colour = isCoverage
        ? c === 'Covered'
          ? SEAL
          : c === 'Partial'
            ? AMBER
            : c
              ? FLAG
              : INK2
        : INK2;
      doc.fillColor(colour).text(c, x + 4, y + 4, { width: cols[i] - 8, height: rowHeight - 6, ellipsis: true });
      x += cols[i];
    });

    doc.strokeColor('#E5EBED').lineWidth(0.5).moveTo(M, y + rowHeight).lineTo(M + pageWidth, y + rowHeight).stroke();
    doc.y = y + rowHeight;
  });

  if (!sheet.rows.length) {
    doc.fillColor(INK3).fontSize(9).text('No rows.', M + 4, doc.y + 8);
    doc.moveDown(0.5);
  }
}

/* ------------------------------------------------------------------ *
 * Content type + filename helpers
 * ------------------------------------------------------------------ */

export const CONTENT_TYPE = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export function fileName(base: string, format: 'csv' | 'xlsx' | 'pdf'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `policy-prism-${base}-${stamp}.${format}`;
}
