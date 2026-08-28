import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PolicyDto,
  POLICY_SCOPE_LABEL,
  POLICY_SCOPE_OPTIONS,
  PolicyScope,
} from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import {
  Drawer,
  ErrorState,
  Modal,
  PageHeader,
  Pager,
  Panel,
  SkeletonTable,
} from '@/components/ui';
import ImportPreviewModal, { type PreviewItem } from '@/components/ImportPreviewModal';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

interface Draft {
  id?: number;
  code: string;
  title: string;
  owner: string;
  version: string;
  effectiveDate: string;
  scope: PolicyScope;
  text: string;
}

const emptyDraft = (): Draft => ({
  code: '',
  title: '',
  owner: '',
  version: '1.0',
  effectiveDate: new Date().toISOString().slice(0, 10),
  scope: 'regulatory',
  text: '',
});

export default function PoliciesPage() {
  const { can, user } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PolicyDto | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ currentCount: number; errors: string[] }>({
    currentCount: 0,
    errors: [],
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['policies', page, q, scope],
    queryFn: async () => await api.get<PolicyDto[]>('/api/policies', { page, perPage: 50, q, scope }),
  });

  const { data: detail } = useQuery({
    queryKey: ['policy', viewId],
    queryFn: async () => (await api.get<PolicyDto>(`/api/policies/${viewId}`)).data,
    enabled: viewId !== null,
  });

  const save = useMutation({
    mutationFn: async (d: Draft) =>
      d.id
        ? (await api.patch<PolicyDto>(`/api/policies/${d.id}`, d)).data
        : (await api.post<PolicyDto>('/api/policies', d)).data,
    onSuccess: (p) => {
      toast(`${p.code || p.title} saved as v${p.version}. Re-run the analysis to see the effect.`);
      setDraft(null);
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not save the policy'),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.del(`/api/policies/${id}`)).data,
    onSuccess: () => {
      toast('Policy deleted.');
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
      // Parse and report only - nothing is written until the user confirms.
      return await api.upload<PreviewItem[]>('/api/policies/upload?preview=true', form);
    },
    onSuccess: (res) => {
      const meta = res.meta as { errors?: string[]; currentCount?: number } | undefined;
      const errs = meta?.errors ?? [];
      if (!res.data.length) {
        errorToast(errs[0] ?? 'Nothing readable was found in that file.');
        return;
      }
      setPreviewMeta({ currentCount: meta?.currentCount ?? 0, errors: errs });
      setPreview(res.data);
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Upload failed'),
  });

  const meta = data?.meta as
    | { total?: number; tally?: { total: number; regulatory: number; operational: number; governance: number } }
    | undefined;
  const policies = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Policies"
        description="Your policy documents"
        actions={
          can('edit') ? (
            <>
              <button type="button" className="pp-btn" onClick={() => fileInput.current?.click()}>
                Upload
              </button>
              <button
                type="button"
                className="pp-btn pp-btn-primary"
                onClick={() => setDraft(emptyDraft())}
              >
                New policy
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

      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        {can('edit') && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length) uploadFiles.mutate(dropped);
            }}
            className={`rounded border-[1.5px] border-dashed px-5 py-6 text-center transition-colors ${
              dragging ? 'border-auto bg-auto-bg' : 'border-line bg-panel-2'
            }`}
          >
            <b className="mb-1 block text-[15px]">
              {uploadFiles.isPending ? 'Reading files\u2026' : 'Drop policy documents here'}
            </b>
            <p className="m-0 text-xs2 text-ink-3">
              Each file becomes one policy. Use CSV, XLSX or JSON to load many at once.
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
              Spreadsheet or CSV columns: code, title, owner, version, effective, text &mdash; every sheet in a
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
                placeholder="Search policies"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
              <select
                className="pp-select w-auto"
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All scopes</option>
                {POLICY_SCOPE_OPTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          }
          actions={
            <div className="flex items-center gap-3">
              <span className="pp-sub">
                {meta?.tally?.regulatory ?? 0} regulatory &middot; {meta?.tally?.operational ?? 0} operational
                &middot; {meta?.tally?.governance ?? 0} governance
              </span>
              <Pager page={page} perPage={50} total={meta?.total ?? 0} onPage={setPage} />
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
                    <th className="w-[100px]">Code</th>
                    <th>Title</th>
                    <th className="w-[180px]">Owner</th>
                    <th className="w-[70px]">Version</th>
                    <th className="w-[110px]">Effective</th>
                    <th className="w-[110px]">Scope</th>
                    <th className="w-[110px]" />
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="pp-row-click" onClick={() => setViewId(p.id)}>
                      <td className="font-mono text-tiny">{p.code || '—'}</td>
                      <td>
                        <b className="font-medium">{p.title}</b>
                        {p.source === 'upload' && <span className="pp-pill pp-pill-up ml-2">uploaded</span>}
                        {p.stale && <span className="pp-pill pp-pill-par ml-2">overdue for review</span>}
                      </td>
                      <td className="text-ink-2">{p.owner}</td>
                      <td className="font-mono">v{p.version}</td>
                      <td className="font-mono text-tiny text-ink-3">{p.effectiveDate ?? '—'}</td>
                      <td>
                        <span
                          className={`pp-pill ${p.scope === 'regulatory' ? 'pp-pill-cov' : 'pp-pill-pen'}`}
                        >
                          {POLICY_SCOPE_LABEL[p.scope]}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {can('edit') && (
                          <span className="flex gap-1.5">
                            <button
                              type="button"
                              className="pp-btn pp-btn-sm"
                              onClick={() =>
                                setDraft({
                                  id: p.id,
                                  code: p.code,
                                  title: p.title,
                                  owner: p.owner,
                                  version: p.version,
                                  effectiveDate: p.effectiveDate ?? '',
                                  scope: p.scope,
                                  text: p.text,
                                })
                              }
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="pp-btn pp-btn-sm"
                              title="Delete"
                              onClick={() => setConfirmDelete(p)}
                            >
                              &times;
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!policies.length && (
                    <tr>
                      <td colSpan={7} className="pp-empty">
                        No policies match those filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <ImportPreviewModal
        items={preview}
        currentCount={previewMeta.currentCount}
        errors={previewMeta.errors}
        onClose={() => setPreview(null)}
      />

      {/* ---- view drawer ---- */}
      <Drawer
        open={viewId !== null && !draft}
        onClose={() => setViewId(null)}
        eyebrow={
          detail && (
            <>
              <span className="pp-pill pp-pill-fw">{detail.code || 'policy'}</span>
              {detail.source === 'upload' && <span className="pp-pill pp-pill-up">uploaded</span>}
              {detail.stale && <span className="pp-pill pp-pill-par">overdue for review</span>}
            </>
          )
        }
        title={detail?.title ?? 'Policy'}
        subtitle={
          detail
            ? `v${detail.version} \u00b7 ${detail.owner} \u00b7 effective ${detail.effectiveDate ?? 'unset'}`
            : undefined
        }
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
                      code: detail.code,
                      title: detail.title,
                      owner: detail.owner,
                      version: detail.version,
                      effectiveDate: detail.effectiveDate ?? '',
                      scope: detail.scope,
                      text: detail.text,
                    })
                  }
                >
                  Edit this policy
                </button>
                <button type="button" className="pp-btn" onClick={() => setConfirmDelete(detail)}>
                  Delete
                </button>
              </div>
            )}

            <div className="pp-label mb-1.5">Policy text</div>
            <div className="pp-quote">{detail.text}</div>

            {!!detail.versions?.length && (
              <>
                <div className="pp-label mb-1.5 mt-5">Version history ({detail.versions.length})</div>
                {detail.versions.map((v) => (
                  <div key={v.id} className="border-b border-line-2 py-2.5 last:border-b-0">
                    <b className="font-medium">v{v.version}</b>{' '}
                    <span className="font-mono text-tiny text-ink-3">
                      {v.supersededAt ? `superseded ${v.supersededAt.slice(0, 10)}` : 'current'}
                      {v.authorName ? ` \u00b7 ${v.authorName}` : ''}
                    </span>
                    <div className="mt-1 text-xs2 text-ink-3">
                      {v.text.slice(0, 160)}
                      {v.text.length > 160 ? '\u2026' : ''}
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </Drawer>

      {/* ---- edit drawer ---- */}
      <Drawer
        open={!!draft}
        onClose={() => setDraft(null)}
        eyebrow={
          <span className="pp-pill pp-pill-up">{draft?.id ? 'editing' : 'new policy'}</span>
        }
        title={draft?.id ? 'Revise policy' : 'Create policy'}
        subtitle={
          draft?.id
            ? 'Saving supersedes the current version. The old text is kept in version history.'
            : 'This becomes a new policy in your set.'
        }
      >
        {draft && (
          <div className="space-y-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="pp-field">
                <label htmlFor="p-code">Policy code</label>
                <input
                  id="p-code"
                  className="pp-input"
                  placeholder="IS-760"
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                />
              </div>
              <div className="pp-field">
                <label htmlFor="p-owner">Owner</label>
                <input
                  id="p-owner"
                  className="pp-input"
                  placeholder="Information Security"
                  value={draft.owner}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                />
              </div>
            </div>

            <div className="pp-field">
              <label htmlFor="p-title">Title</label>
              <input
                id="p-title"
                className="pp-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            <div className="pp-field">
              <label htmlFor="p-scope">Regulatory scope</label>
              <select
                id="p-scope"
                className="pp-select"
                value={draft.scope}
                onChange={(e) => setDraft({ ...draft, scope: e.target.value as PolicyScope })}
              >
                {POLICY_SCOPE_OPTIONS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[12px] text-ink-3">
                Only regulatory policies are matched against requirements. Operational and governance policies
                stay in the library and are never force-mapped to a citation.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="pp-field">
                <label htmlFor="p-ver">Version</label>
                <input
                  id="p-ver"
                  className="pp-input"
                  value={draft.version}
                  onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                />
              </div>
              <div className="pp-field">
                <label htmlFor="p-eff">Effective date</label>
                <input
                  id="p-eff"
                  type="date"
                  className="pp-input"
                  value={draft.effectiveDate}
                  onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
                />
              </div>
            </div>

            <div className="pp-field">
              <label htmlFor="p-text">Policy text</label>
              <textarea
                id="p-text"
                className="pp-textarea"
                rows={16}
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
              <p className="mt-1 text-tiny text-ink-3">
                {draft.text.length} characters — at least 40 are needed to score against a requirement.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-line-2 pt-3.5">
              <button
                type="button"
                className="pp-btn pp-btn-primary"
                disabled={save.isPending || draft.title.trim().length < 2 || draft.text.trim().length < 40}
                onClick={() =>
                  save.mutate({
                    ...draft,
                    effectiveDate: draft.effectiveDate || new Date().toISOString().slice(0, 10),
                  })
                }
              >
                {save.isPending ? 'Saving\u2026' : draft.id ? 'Save new version' : 'Create policy'}
              </button>
              <button type="button" className="pp-btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
            <p className="text-xs2 text-ink-3">
              Saving does not re-run the analysis automatically — press Run analysis when you are ready to see
              whether the gap closed.
            </p>
          </div>
        )}
      </Drawer>

      {/* ---- delete confirm ---- */}
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this policy?"
        description={confirmDelete ? `${confirmDelete.code || ''} ${confirmDelete.title}` : ''}
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
              {remove.isPending ? 'Deleting\u2026' : 'Delete policy'}
            </button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          The policy and its version history are removed. Findings from past analysis runs keep the citation
          and the score, but lose the link to this document. The audit trail keeps a record of the deletion.
        </p>
      </Modal>
    </>
  );
}
