import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_CATEGORY_LABEL, AuditCategory, AuditEntryDto } from '@policy-prism/shared';
import { api, downloadFile } from '@/api/client';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pager,
  Panel,
  SkeletonTable,
  formatDateTime,
} from '@/components/ui';
import { useToast } from '@/hooks/useToast';

const CATEGORY_PILL: Record<AuditCategory, string> = {
  review: 'pp-pill-cov',
  document: 'pp-pill-up',
  export: 'pp-pill-fw',
  profile: 'pp-pill-par',
  analysis: 'pp-pill-pen',
  system: 'pp-pill-pen',
};

export default function AuditPage() {
  const { toast, errorToast } = useToast();
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', page, q, category],
    queryFn: async () => await api.get<AuditEntryDto[]>('/api/audit', { page, perPage: 60, q, category }),
  });

  const meta = data?.meta as
    | {
        total?: number;
        grandTotal?: number;
        categories?: Array<{ key: AuditCategory; label: string; count: number }>;
        note?: string;
      }
    | undefined;
  const rows = data?.data ?? [];

  if (!isLoading && !error && !meta?.grandTotal) {
    return (
      <>
        <PageHeader title="Audit trail" description="Every action, who did it, and when" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState
            title="Nothing recorded yet"
            message="Every document change, analysis run, review decision and export is written here."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every action, who did it, and when"
        actions={
          <button
            type="button"
            className="pp-btn"
            onClick={() =>
              downloadFile('/api/reports/export', { kind: 'audit', format: 'xlsx' })
                .then((n) => toast(`Downloaded ${n}`))
                .catch((e) => errorToast(e.message))
            }
          >
            Export trail
          </button>
        }
      />

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
        <Panel
          title={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="pp-input w-[280px]"
                placeholder="Search the trail"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
              <button
                type="button"
                className={`pp-btn pp-btn-sm ${category === 'export' ? 'pp-btn-primary' : ''}`}
                title="Show who downloaded reports"
                onClick={() => {
                  setCategory(category === 'export' ? '' : 'export');
                  setPage(0);
                }}
              >
                Downloads
              </button>
              <button
                type="button"
                className={`pp-btn pp-btn-sm ${category === 'profile' ? 'pp-btn-primary' : ''}`}
                title="Hospital profile changes and switches"
                onClick={() => {
                  setCategory(category === 'profile' ? '' : 'profile');
                  setPage(0);
                }}
              >
                Profiles
              </button>
              <select
                className="pp-select w-auto"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All categories</option>
                {(meta?.categories ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({c.count})
                  </option>
                ))}
              </select>
            </div>
          }
          actions={
            <div className="flex items-center gap-3">
              <span className="pp-sub">
                {meta?.total ?? 0} of {meta?.grandTotal ?? 0} entries
              </span>
              <Pager page={page} perPage={60} total={meta?.total ?? 0} onPage={setPage} />
            </div>
          }
        >
          {isLoading && <SkeletonTable rows={6} cols={5} />}
          {error && <ErrorState error={error} onRetry={refetch} />}
          {!isLoading && !error && (
            <>
              <div className="overflow-x-auto">
                <table className="pp-table">
                  <thead>
                    <tr>
                      <th className="w-[52px]">#</th>
                      <th className="w-[150px]">When</th>
                      <th className="w-[96px]">Category</th>
                      <th>Action</th>
                      <th className="w-[150px]">Object</th>
                      <th className="w-[160px]">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.id}>
                        <td className="font-mono text-ink-3">{l.seq}</td>
                        <td className="font-mono text-tiny text-ink-3">{formatDateTime(l.createdAt)}</td>
                        <td>
                          <span className={`pp-pill ${CATEGORY_PILL[l.category]}`}>
                            {AUDIT_CATEGORY_LABEL[l.category]}
                          </span>
                        </td>
                        <td>
                          {l.action}
                          {l.detail && <div className="mt-0.5 text-[12px] text-ink-3">{l.detail}</div>}
                        </td>
                        <td className="font-mono text-tiny text-ink-3">{l.object || '—'}</td>
                        <td className="text-ink-3">
                          {l.actorName}
                          {l.actorRole && <div className="text-tiny">{l.actorRole}</div>}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr>
                        <td colSpan={6} className="pp-empty">
                          Nothing matches those filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pp-pad border-t border-line-2">
                <p className="m-0 text-xs2 text-ink-3">{meta?.note}</p>
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
