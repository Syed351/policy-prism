import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { APPLICABILITY_OPTIONS, FRAMEWORKS, Framework } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import { useToast } from '@/hooks/useToast';

export interface RegPreviewItem {
  key: string;
  framework: Framework;
  citation: string;
  title: string;
  /** Preview only: the full text stays on the server until commit. */
  snippet: string;
  textLength: number;
  applicability: string;
  fileName: string;
  existingId: number | null;
  existingTitle: string | null;
  /** This citation appears more than once in the uploaded file. */
  duplicateInFile?: boolean;
}

/**
 * "Check before importing" for requirements. A prose document splits into many
 * requirements and picks up noise along the way, so nothing is written until
 * the user has unchecked the rubbish and set the framework.
 */
const PAGE = 50;

export default function RegulationImportModal({
  items,
  importId,
  currentCount,
  existingMatches,
  duplicatesInFile,
  errors,
  state,
  onClose,
}: {
  items: RegPreviewItem[] | null;
  importId: string;
  currentCount: number;
  existingMatches: number;
  duplicatesInFile: number;
  errors: string[];
  state: string;
  onClose: () => void;
}) {
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RegPreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'replace' | 'append'>('append');
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (items) {
      setRows(items);
      setSelected(new Set(items.map((i) => i.key)));
    }
  }, [items]);

  const commit = useMutation({
    mutationFn: async () => {
      const chosen = rows.filter((r) => selected.has(r.key));
      // Send keys and edits only - the server already holds the parsed text.
      return await api.post<unknown>('/api/regulations/import-commit', {
        importId,
        mode,
        items: chosen.map(({ key, framework, citation, title, applicability }) => ({
          key, framework, citation, title, applicability,
        })),
      });
    },
    onSuccess: (res) => {
      const m = res.meta as
        | { imported?: number; removed?: number; amended?: number; collapsed?: number }
        | undefined;
      toast(
        `${m?.imported ?? 0} requirements imported` +
          (m?.amended ? ` \u00b7 ${m.amended} amended` : '') +
          (m?.removed ? ` \u00b7 ${m.removed} replaced` : '') +
          (m?.collapsed ? ` \u00b7 ${m.collapsed} duplicate(s) collapsed` : '') +
          '. Re-run the analysis to score them.',
      );
      queryClient.invalidateQueries();
      onClose();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Import failed'),
  });

  if (!items) return null;

  const update = (key: string, patch: Partial<RegPreviewItem>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const toggle = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allOn = selected.size === rows.length && rows.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-[rgba(14,28,38,.45)]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[92vh] w-[min(1140px,100%)] flex-col rounded-md bg-panel shadow-xl"
      >
        <header className="border-b border-line-2 px-7 pb-4 pt-6">
          <h3 className="text-[18px]">Check before importing</h3>
          <p className="mt-1 max-w-4xl text-xs2 text-ink-3">
            {rows.length} requirements parsed from your document. Uncheck anything that came through as
            noise, fix a citation, and set the framework.
            {existingMatches > 0 &&
              ` ${existingMatches} citation${existingMatches === 1 ? '' : 's'} already in your library \u2014 amending keeps one entry with its wording history.`}
          </p>

          {duplicatesInFile > 0 && (
            <div className="pp-note mt-3">
              {duplicatesInFile} row(s) repeat a citation already used elsewhere in this file. Only the
              last version of each citation is imported, since a requirement exists once per facility.
            </div>
          )}

          {errors.length > 0 && (
            <div className="pp-note pp-note-bad mt-3">
              {errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(
              [
                ['replace', 'Replace the requirement library', `Removes the ${currentCount} requirements already loaded, and with them the per-requirement detail of past analysis runs. Use this when you start on a new hospital.`],
                ['append', 'Add to what is loaded', 'Keeps the existing requirements. Use this when one facility\u2019s library spans several files.'],
              ] as Array<['replace' | 'append', string, string]>
            ).map(([key, label, blurb]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-start gap-2.5 rounded border px-3.5 py-3 ${
                  mode === key ? 'border-seal bg-seal-bg' : 'border-line'
                }`}
              >
                <input
                  type="radio"
                  name="reg-import-mode"
                  className="mt-1"
                  checked={mode === key}
                  onChange={() => setMode(key)}
                />
                <span>
                  <b className="block text-[13px] font-medium">{label}</b>
                  <em className="not-italic text-tiny text-ink-3">{blurb}</em>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs2 text-ink-3">Set all to</span>
            {FRAMEWORKS.map((f) => (
              <button
                key={f}
                type="button"
                className="pp-btn pp-btn-sm"
                onClick={() => setRows((rs) => rs.map((r) => ({ ...r, framework: f })))}
              >
                {f}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-auto">
          <table className="pp-table">
            <thead>
              <tr>
                <th className="w-[42px]">
                  <input
                    type="checkbox"
                    checked={allOn}
                    onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.key)))}
                  />
                </th>
                <th className="w-[150px]">Citation</th>
                <th className="w-[120px]">Framework</th>
                <th className="w-[100px]">Existing</th>
                <th className="w-[200px]">Title</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                <tr key={r.key} className={selected.has(r.key) ? '' : 'opacity-45'}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                  </td>
                  <td>
                    <input
                      className="pp-input font-mono text-[12px]"
                      value={r.citation}
                      onChange={(e) => update(r.key, { citation: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="pp-select text-[12px]"
                      value={r.framework}
                      onChange={(e) => update(r.key, { framework: e.target.value as Framework })}
                    >
                      {FRAMEWORKS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <select
                      className="pp-select mt-1.5 text-[11px]"
                      value={r.applicability.startsWith('state:') ? 'state' : r.applicability}
                      onChange={(e) =>
                        update(r.key, {
                          applicability: e.target.value === 'state' ? `state:${state}` : e.target.value,
                        })
                      }
                    >
                      {APPLICABILITY_OPTIONS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {k === 'state' ? `${label} (${state})` : label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs2 text-ink-3">
                    {r.existingId ? <span className="pp-pill pp-pill-par">amends</span> : 'New'}
                    {r.duplicateInFile && (
                      <div className="mt-1">
                        <span className="pp-pill pp-pill-gap">repeat</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      className="pp-input"
                      value={r.title}
                      onChange={(e) => update(r.key, { title: e.target.value })}
                    />
                  </td>
                  <td className="text-xs2 text-ink-3">
                    {r.snippet}
                    {r.textLength > r.snippet.length ? '\u2026' : ''}
                    <div className="mt-1 font-mono text-tiny">{r.textLength} chars</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-7 py-4">
          <span className="flex items-center gap-3 text-xs2 text-ink-3">
            {selected.size} selected of {rows.length}
            {rows.length > PAGE && (
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="pp-btn pp-btn-sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </button>
                <span>
                  {page + 1}/{Math.ceil(rows.length / PAGE)}
                </span>
                <button
                  type="button"
                  className="pp-btn pp-btn-sm"
                  disabled={page >= Math.ceil(rows.length / PAGE) - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </span>
            )}
          </span>
          <span className="flex gap-2">
            <button type="button" className="pp-btn" onClick={onClose} disabled={commit.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              disabled={!selected.size || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? 'Importing\u2026' : 'Import selected'}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
