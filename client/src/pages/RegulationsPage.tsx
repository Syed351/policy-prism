import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPLICABILITY_OPTIONS,
  FRAMEWORKS,
  Framework,
  RegulationDto,
} from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import {
  CoveragePill,
  Drawer,
  ErrorState,
  FrameworkPill,
  Modal,
  PageHeader,
  Pager,
  Panel,
  SkeletonTable,
} from '@/components/ui';
import RegulationImportModal, { type RegPreviewItem } from '@/components/RegulationImportModal';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

interface Draft {
  id?: number;
  framework: Framework;
  citation: string;
  title: string;
  requirementText: string;
  applicability: string;
  effectiveDate: string;
  sourceRef: string;
}

const emptyDraft = (state: string): Draft => ({
  framework: 'Custom',
  citation: '',
  title: '',
  requirementText: '',
  applicability: 'always',
  effectiveDate: '',
  sourceRef: '',
});

/** Applicability keys map to a readable label; state gets the actual code. */
function applicabilityLabel(value: string, state: string): string {
  if (value.startsWith('state:')) return `${value.slice(6)} state requirement`;
  return APPLICABILITY_OPTIONS.find(([k]) => k === value)?.[1] ?? value;
}

export default function RegulationsPage() {
  const { can, user } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [framework, setFramework] = useState('');
  const [scope, setScope] = useState<'all' | 'in' | 'out'>('in');
  const [viewId, setViewId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RegulationDto | null>(null);
  const [preview, setPreview] = useState<RegPreviewItem[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{
    importId: string;
    currentCount: number;
    existingMatches: number;
    duplicatesInFile: number;
    errors: string[];
  }>({ importId: '', currentCount: 0, existingMatches: 0, duplicatesInFile: 0, errors: [] });
  const [includeOutOfScope, setIncludeOutOfScope] = useState(false);
  const [dragging, setDragging] = useState(false);

  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api.get<{ profile: { state: string } }>('/api/hospital/profile')).data.profile,
  });
  const state = profileData?.state ?? 'OH';

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['regulations', page, q, framework, scope],
    queryFn: async () =>
      await api.get<RegulationDto[]>('/api/regulations', { page, perPage: 100, q, framework, scope }),
  });

  const detail = (data?.data ?? []).find((r) => r.id === viewId) ?? null;

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const payload = {
        framework: d.framework,
        citation: d.citation,
        title: d.title,
        requirementText: d.requirementText,
        applicability: d.applicability === 'state' ? `state:${state}` : d.applicability,
        effectiveDate: d.effectiveDate || null,
        sourceRef: d.sourceRef || null,
      };
      return d.id
        ? (await api.patch<RegulationDto>(`/api/regulations/${d.id}`, payload)).data
        : (await api.post<RegulationDto>('/api/regulations', payload)).data;
    },
    onSuccess: (r) => {
      toast(`${r.citation} saved.`);
      setDraft(null);
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not save'),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.del(`/api/regulations/${id}`)).data,
    onSuccess: () => {
      toast('Requirement removed from the library.');
      setConfirmDelete(null);
      setViewId(null);
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not delete'),
  });

  const uploadFiles = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append('files', f));
      return await api.upload<RegPreviewItem[]>('/api/regulations/upload?preview=true', form);
    },
    onSuccess: (res) => {
      const meta = res.meta as
        | {
            errors?: string[];
            currentCount?: number;
            existingMatches?: number;
            duplicatesInFile?: number;
            importId?: string;
          }
        | undefined;
      const errs = meta?.errors ?? [];
      if (!res.data.length) {
        errorToast(errs[0] ?? 'No requirements could be read from that file.');
        return;
      }
      setPreviewMeta({
        importId: meta?.importId ?? '',
        currentCount: meta?.currentCount ?? 0,
        existingMatches: meta?.existingMatches ?? 0,
        duplicatesInFile: meta?.duplicatesInFile ?? 0,
        errors: errs,
      });
      setPreview(res.data);
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Import failed'),
  });

  const meta = data?.meta as
    | { total?: number; inScope?: number; library?: number; frameworkTally?: Record<string, number> }
    | undefined;
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Regulations"
        description="Requirement library scoped to this facility"
        actions={
          can('edit') ? (
            <>
              <button type="button" className="pp-btn" onClick={() => fileInput.current?.click()}>
                Upload regulations
              </button>
              <button
                type="button"
                className="pp-btn pp-btn-primary"
                onClick={() => setDraft(emptyDraft(state))}
              >
                New requirement
              </button>
            </>
          ) : (
            <span className="text-xs2 text-ink-3">Your role ({user?.roleLabel}) is read only here</span>
          )
        }
      />

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.xlsx,.xls,.csv,.tsv,.txt,.md,.json"
        onChange={(e) => {
          // Copy the FileList into a real array before clearing the input.
          // FileList is live-bound to the element, so resetting value empties
          // it - and mutate() runs asynchronously, after that reset.
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length) uploadFiles.mutate(picked);
        }}
      />

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
      {can('edit') && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = Array.from(e.dataTransfer.files);
            if (dropped.length) uploadFiles.mutate(dropped);
          }}
          className={`mb-3.5 rounded border-[1.5px] border-dashed px-5 py-8 text-center transition-colors ${
            dragging ? 'border-auto bg-auto-bg' : 'border-line bg-panel-2'
          }`}
        >
          <b className="mb-1 block text-[15px]">
            {uploadFiles.isPending ? 'Reading documents\u2026' : 'Drop regulation documents here'}
          </b>
          <p className="m-0 text-xs2 text-ink-3">
            Each file is split into individual requirements you can check before importing.
          </p>
          <button
            type="button"
            className="pp-btn pp-btn-primary mx-auto mt-3.5"
            disabled={uploadFiles.isPending}
            onClick={() => fileInput.current?.click()}
          >
            Choose files
          </button>
          <div className="mt-3.5 text-tiny text-ink-3">
            PDF &middot; DOCX &middot; XLSX &middot; CSV &middot; TXT &middot; MD &middot; JSON
          </div>
          <div className="mt-1 text-tiny text-ink-3">
            Spreadsheet or CSV columns: framework, citation, title, text, applies &mdash; every sheet in a
            workbook is read
          </div>
        </div>
      )}

        <Panel
          title={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="pp-input w-[280px]"
                placeholder="Search citation, title or text"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
              <select
                className="pp-select w-auto"
                value={framework}
                onChange={(e) => {
                  setFramework(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All frameworks</option>
                {FRAMEWORKS.map((f) => (
                  <option key={f} value={f}>
                    {f} ({meta?.frameworkTally?.[f] ?? 0})
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded border border-line px-3 py-1.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={includeOutOfScope}
                  onChange={(e) => {
                    setIncludeOutOfScope(e.target.checked);
                    setScope(e.target.checked ? 'all' : 'in');
                    setPage(0);
                  }}
                />
                Include out of scope ({Math.max(0, (meta?.library ?? 0) - (meta?.inScope ?? 0))})
              </label>
            </div>
          }
          actions={
            <div className="flex items-center gap-3">
              <span className="pp-sub">
                {meta?.inScope ?? 0} in scope of {meta?.library ?? 0} in the library
              </span>
              <Pager page={page} perPage={100} total={meta?.total ?? 0} onPage={setPage} />
            </div>
          }
        >
          {isLoading && <SkeletonTable rows={6} cols={5} />}
          {error && <ErrorState error={error} onRetry={refetch} />}
          {!isLoading && !error && (
            <div className="overflow-x-auto">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="w-[94px]">Framework</th>
                    <th className="w-[150px]">Citation</th>
                    <th>Requirement</th>
                    <th className="w-[130px]">Coverage</th>
                    <th className="w-[110px]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="pp-row-click" onClick={() => setViewId(r.id)}>
                      <td><FrameworkPill framework={r.framework} /></td>
                      <td className="font-mono text-tiny">{r.citation}</td>
                      <td>
                        <b className="font-medium">{r.title}</b>
                        <div className="mt-0.5 line-clamp-2 text-tiny text-ink-3">{r.requirementText}</div>
                      </td>
                      <td className="text-xs2 text-ink-3">
                        {r.coverageStatus ? (
                          <CoveragePill status={r.coverageStatus} />
                        ) : (
                          <span className="text-ink-3">Not analyzed</span>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {!r.applies && <span className="pp-pill pp-pill-pen">out of scope</span>}
                          {r.upcoming && <span className="pp-pill pp-pill-par">upcoming</span>}
                          {r.amendedAt && <span className="pp-pill pp-pill-up">amended</span>}
                        </div>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {can('edit') && (
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              className="pp-btn pp-btn-sm"
                              onClick={() =>
                                setDraft({
                                  id: r.id,
                                  framework: r.framework,
                                  citation: r.citation,
                                  title: r.title,
                                  requirementText: r.requirementText,
                                  applicability: r.applicability,
                                  effectiveDate: r.effectiveDate ?? '',
                                  sourceRef: r.sourceRef ?? '',
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="pp-btn pp-btn-sm"
                              title="Remove"
                              onClick={() => setConfirmDelete(r)}
                            >
                              &times;
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="pp-empty">
                        No requirements match those filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <RegulationImportModal
        items={preview}
        importId={previewMeta.importId}
        currentCount={previewMeta.currentCount}
        existingMatches={previewMeta.existingMatches}
        duplicatesInFile={previewMeta.duplicatesInFile}
        errors={previewMeta.errors}
        state={state}
        onClose={() => setPreview(null)}
      />

      {/* ---- view drawer ---- */}
      <Drawer
        open={viewId !== null && !draft}
        onClose={() => setViewId(null)}
        eyebrow={
          detail && (
            <>
              <FrameworkPill framework={detail.framework} />
              {!detail.applies && <span className="pp-pill pp-pill-pen">out of scope</span>}
              {detail.upcoming && <span className="pp-pill pp-pill-par">not yet in effect</span>}
            </>
          )
        }
        title={detail?.title ?? 'Requirement'}
        subtitle={detail?.citation}
      >
        {detail && (
          <>
            {can('edit') && (
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="pp-btn pp-btn-primary"
                  onClick={() =>
                    setDraft({
                      id: detail.id,
                      framework: detail.framework,
                      citation: detail.citation,
                      title: detail.title,
                      requirementText: detail.requirementText,
                      applicability: detail.applicability,
                      effectiveDate: detail.effectiveDate ?? '',
                      sourceRef: detail.sourceRef ?? '',
                    })
                  }
                >
                  Edit
                </button>
                <button type="button" className="pp-btn" onClick={() => setConfirmDelete(detail)}>
                  Remove
                </button>
              </div>
            )}

            <div className="pp-label mb-1.5">Requirement text</div>
            <div className="pp-quote">{detail.requirementText}</div>

            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <dt className="text-ink-3">Applies to</dt>
              <dd className="m-0">{applicabilityLabel(detail.applicability, state)}</dd>
              <dt className="text-ink-3">Effective</dt>
              <dd className="m-0">{detail.effectiveDate ?? 'in force'}</dd>
              {detail.amendedAt && (
                <>
                  <dt className="text-ink-3">Amended</dt>
                  <dd className="m-0">{detail.amendedAt}</dd>
                </>
              )}
              {detail.sourceRef && (
                <>
                  <dt className="text-ink-3">Source</dt>
                  <dd className="m-0">{detail.sourceRef}</dd>
                </>
              )}
            </dl>

            {detail.amendedAt && (
              <div className="pp-note mt-4">
                This requirement was amended. Findings that were reviewed against the previous wording are
                flagged for re-review in the queue.
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ---- edit drawer ---- */}
      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        eyebrow={<span className="pp-pill pp-pill-up">{draft?.id ? 'editing' : 'new requirement'}</span>}
        title={draft?.id ? 'Edit requirement' : 'Add requirement'}
        subtitle={draft?.id ? 'Changing the text stamps an amendment date.' : undefined}
      >
        {draft && (
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="pp-field">
                <label htmlFor="r-fw">Framework</label>
                <select
                  id="r-fw"
                  className="pp-select"
                  value={draft.framework}
                  onChange={(e) => setDraft({ ...draft, framework: e.target.value as Framework })}
                >
                  {FRAMEWORKS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pp-field">
                <label htmlFor="r-cite">Citation</label>
                <input
                  id="r-cite"
                  className="pp-input font-mono"
                  placeholder="§482.13(a)(1)"
                  value={draft.citation}
                  onChange={(e) => setDraft({ ...draft, citation: e.target.value })}
                />
              </div>
            </div>

            <div className="pp-field">
              <label htmlFor="r-title">Title</label>
              <input
                id="r-title"
                className="pp-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            <div className="pp-field">
              <label htmlFor="r-ap">Applies to</label>
              <select
                id="r-ap"
                className="pp-select"
                value={draft.applicability.startsWith('state:') ? 'state' : draft.applicability}
                onChange={(e) => setDraft({ ...draft, applicability: e.target.value })}
              >
                {APPLICABILITY_OPTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {k === 'state' ? `${label} (${state})` : label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12px] text-ink-3">
                This decides whether the requirement is in scope for the facility profile.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="pp-field">
                <label htmlFor="r-eff">Effective date (optional)</label>
                <input
                  id="r-eff"
                  type="date"
                  className="pp-input"
                  value={draft.effectiveDate}
                  onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
                />
              </div>
              <div className="pp-field">
                <label htmlFor="r-src">Source reference</label>
                <input
                  id="r-src"
                  className="pp-input"
                  placeholder="42 CFR Part 482"
                  value={draft.sourceRef}
                  onChange={(e) => setDraft({ ...draft, sourceRef: e.target.value })}
                />
              </div>
            </div>

            <div className="pp-field">
              <label htmlFor="r-text">Requirement text</label>
              <textarea
                id="r-text"
                className="pp-textarea"
                rows={12}
                value={draft.requirementText}
                onChange={(e) => setDraft({ ...draft, requirementText: e.target.value })}
              />
              <p className="mt-1 text-tiny text-ink-3">
                {draft.requirementText.length} characters — at least 40 are needed.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line-2 pt-3.5">
              <button
                type="button"
                className="pp-btn pp-btn-primary"
                disabled={
                  save.isPending ||
                  !draft.citation.trim() ||
                  draft.title.trim().length < 2 ||
                  draft.requirementText.trim().length < 40
                }
                onClick={() => save.mutate(draft)}
              >
                {save.isPending ? 'Saving\u2026' : draft.id ? 'Save requirement' : 'Add to library'}
              </button>
              <button type="button" className="pp-btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Remove this requirement?"
        description={confirmDelete ? `${confirmDelete.citation} \u2014 ${confirmDelete.title}` : ''}
        footer={
          <>
            <button type="button" className="pp-btn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-no"
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              {remove.isPending ? 'Removing\u2026' : 'Remove'}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          The requirement and its findings across every analysis run are removed. If you only want it out of
          scope for this facility, change the applicability instead — that keeps the history intact.
        </p>
      </Modal>
    </>
  );
}
