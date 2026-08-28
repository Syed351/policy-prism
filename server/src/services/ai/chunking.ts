/**
 * Splitting policies into retrievable, citable chunks.
 *
 * Two reasons this matters. A whole policy is too coarse to embed usefully - a
 * six-page document averages into vagueness. And a finding has to point at
 * *where* the evidence is, so a chunk needs a human-readable label the reviewer
 * can locate in the source document.
 *
 * Headings are preferred as boundaries because policies are written in
 * sections; where a document has none, paragraphs are grouped to a target size.
 */

/** Roughly 1200 characters keeps a chunk within one idea while staying citable. */
const TARGET_CHARS = 1200;
const MIN_CHARS = 200;
const OVERLAP_CHARS = 150;

export interface PolicyChunk {
  /** 0-based position within the policy, used for stable ordering. */
  ordinal: number;
  /** Human-readable location, e.g. "PURPOSE" or "Paragraph 3". */
  sectionLabel: string;
  text: string;
  charStart: number;
  charEnd: number;
}

/**
 * Section headings as policies actually write them: all-caps lines, numbered
 * clauses, or short title-case lines ending without a full stop.
 */
const HEADING_RE =
  /^(?:\s*)((?:[A-Z][A-Z \t/&'-]{3,60})|(?:\d+(?:\.\d+)*[.)]\s+[^\n]{3,80})|(?:[IVXLC]+\.\s+[^\n]{3,80}))\s*$/;

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (/[.;:]$/.test(t) && !/^\d/.test(t)) return false;
  return HEADING_RE.test(line);
}

/**
 * Splits a policy into chunks. Always returns at least one chunk for any text
 * with content, so a policy can never silently fail to be indexed.
 */
export function chunkPolicy(text: string, policyCode?: string): PolicyChunk[] {
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const lines = clean.split('\n');
  const sections: Array<{ label: string; body: string; start: number }> = [];

  let currentLabel = policyCode ? `${policyCode} — opening` : 'Opening';
  let buffer: string[] = [];
  let offset = 0;
  let sectionStart = 0;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ label: currentLabel, body, start: sectionStart });
    buffer = [];
  };

  lines.forEach((line) => {
    if (isHeading(line)) {
      flush();
      currentLabel = line.trim();
      sectionStart = offset;
    } else {
      buffer.push(line);
    }
    offset += line.length + 1;
  });
  flush();

  // No headings found: treat the whole document as one section.
  if (!sections.length) {
    sections.push({ label: 'Full text', body: clean, start: 0 });
  }

  const chunks: PolicyChunk[] = [];
  let ordinal = 0;

  sections.forEach((section) => {
    // Short section: one chunk, keeping its heading as the label.
    if (section.body.length <= TARGET_CHARS) {
      chunks.push({
        ordinal: ordinal++,
        sectionLabel: section.label,
        text: section.body,
        charStart: section.start,
        charEnd: section.start + section.body.length,
      });
      return;
    }

    // Long section: split on sentence boundaries, with a little overlap so a
    // requirement spanning a boundary is still retrievable from either side.
    const sentences = section.body.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [section.body];
    let part = '';
    let partIndex = 1;
    let partStart = section.start;

    const pushPart = () => {
      const body = part.trim();
      if (body.length < MIN_CHARS && chunks.length) {
        // Too small to stand alone; fold into the previous chunk.
        const prev = chunks[chunks.length - 1];
        prev.text = `${prev.text}\n${body}`;
        prev.charEnd += body.length;
        return;
      }
      if (!body) return;
      chunks.push({
        ordinal: ordinal++,
        sectionLabel: `${section.label} (part ${partIndex++})`,
        text: body,
        charStart: partStart,
        charEnd: partStart + body.length,
      });
    };

    sentences.forEach((sentence) => {
      if (part.length + sentence.length > TARGET_CHARS && part.length >= MIN_CHARS) {
        pushPart();
        const tail = part.slice(-OVERLAP_CHARS);
        partStart += part.length - tail.length;
        part = tail + sentence;
      } else {
        part += sentence;
      }
    });
    pushPart();
  });

  return chunks;
}

/**
 * A stable fingerprint of the policy text, so re-indexing is skipped when a
 * policy has not changed. Embedding is the expensive step in an analysis run.
 */
export function chunkFingerprint(text: string): string {
  // FNV-1a: fast, dependency-free, and collision risk is irrelevant here since
  // a miss only causes an unnecessary re-embed.
  let h = 0x811c9dc5;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + s.length;
}
