import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PolicyScope, POLICY_SCOPE_OPTIONS } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import { useToast } from '@/hooks/useToast';

export interface PreviewItem {
  key: string;
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string | null;
  scope: PolicyScope;
  text: string;
  fileName: string;
  existingId: number | null;
  existingTitle: string | null;
}

/**
 * "Check before importing" - the prototype's import gate. Nothing is written
 * until the user confirms, so a malformed file cannot quietly fill the library
 * with hundreds of rows.
 */
export default function ImportPreviewModal({
  items,
  currentCount,
  errors,
  onClose,
}: {
  items: PreviewItem[] | null;
  currentCount: number;
  errors: string[];
  onClose: () => void;
}) {
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<PreviewItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'replace' | 'append'>('append');

  useEffect(() => {
    if (items) {
      setRows(items);
      setSelected(new Set(items.map((i) => i.key)));
    }
  }, [items]);

  const commit = useMutation({
    mutationFn: async () => {
      const chosen = rows.filter((r) => selected.has(r.key));
      return await api.post<unknown>('/api/policies/import-commit', {
        mode,
        items: chosen.map(({ code, title, owner, version, effectiveDate, scope, text, fileName }) => ({
          code, title, owner, version, effectiveDate, scope, text, fileName,
        })),
      });
    },
    onSuccess: (res) => {
      const m = res.meta as { imported?: number; removed?: number } | undefined;
      toast(
        `${m?.imported ?? 0} policies imported` +
          (m?.removed ? ` \u00b7 ${m.removed} replaced` : '') +
          '. Re-run the analysis to score them.',
      );
      queryClient.invalidateQueries();
      onClose();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Import failed'),
  });

  if (!items) return null;

  const update = (key: string, patch: Partial<PreviewItem>) =>
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
        className="relative flex max-h-[92vh] w-[min(1080px,100%)] flex-col rounded-md bg-panel shadow-xl"
      >
        <header className="border-b border-line-2 px-7 pb-4 pt-6">
          <h3 className="text-[18px]">Check before importing</h3>
          <p className="mt-1 text-xs2 text-ink-3">
            {rows.length} polic{rows.length === 1 ? 'y' : 'ies'} ready to import.
          </p>

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
                ['replace', 'Replace the policy set', `Removes the ${currentCount} policies already loaded. Use this when you start on a new hospital.`],
                ['append', 'Add to what is loaded', 'Keeps the existing policies. Use this when one facility\u2019s library spans several files.'],
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
                  name="import-mode"
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
                <th className="w-[130px]">Code</th>
                <th className="w-[120px]">Existing policy</th>
                <th className="w-[280px]">Title</th>
                <th>Text</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={selected.has(r.key) ? '' : 'opacity-45'}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} />
                  </td>
                  <td>
                    <input
                      className="pp-input font-mono text-[12px]"
                      value={r.code}
                      onChange={(e) => update(r.key, { code: e.target.value })}
                    />
                  </td>
                  <td className="text-xs2 text-ink-3">
                    {r.existingId ? (
                      <span className="pp-pill pp-pill-par">replaces</span>
                    ) : (
                      <span className="text-ink-3">New</span>
                    )}
                    {r.existingTitle && (
                      <div className="mt-1 text-tiny">{r.existingTitle.slice(0, 40)}</div>
                    )}
                  </td>
                  <td>
                    <input
                      className="pp-input"
                      value={r.title}
                      onChange={(e) => update(r.key, { title: e.target.value })}
                    />
                    <select
                      className="pp-select mt-1.5 text-[12px]"
                      value={r.scope}
                      onChange={(e) => update(r.key, { scope: e.target.value as PolicyScope })}
                    >
                      {POLICY_SCOPE_OPTIONS.map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-xs2 text-ink-3">
                    {r.text.slice(0, 180)}
                    {r.text.length > 180 ? '\u2026' : ''}
                    <div className="mt-1 font-mono text-tiny">
                      {r.owner} &middot; v{r.version} &middot; {r.text.length} chars
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-2 px-7 py-4">
          <span className="text-xs2 text-ink-3">{selected.size} selected</span>
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
