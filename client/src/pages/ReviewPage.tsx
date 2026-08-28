import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MappingDto, ReviewStatus } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import {
  CoveragePill,
  EmptyState,
  ErrorState,
  FrameworkPill,
  PageHeader,
  Pager,
  Panel,
  ReviewPill,
  SkeletonTable,
  formatPct,
} from '@/components/ui';
import { EvidenceDrawer } from '@/pages/MappingPage';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

type QueueItem = MappingDto & { advice: { head: string; body: string } | null };

const FILTERS: Array<ReviewStatus | 'all'> = ['pending', 'approved', 'rejected', 'all'];

export default function ReviewPage() {
  const { can, user } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ReviewStatus | 'all'>('pending');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [rejectError, setRejectError] = useState<Record<number, string>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reviews', status, page],
    queryFn: async () => await api.get<QueueItem[]>('/api/reviews', { status, page, perPage: 50 }),
  });

  const decide = useMutation({
    mutationFn: async ({
      id,
      action,
      comment,
    }: {
      id: number;
      action: 'approve' | 'reject' | 'reopen';
      comment?: string;
    }) => (await api.post(`/api/reviews/${id}/${action}`, comment ? { comment } : {})).data,
    onSuccess: (_d, vars) => {
      toast(
        vars.action === 'approve'
          ? 'Finding approved.'
          : vars.action === 'reject'
            ? 'Finding rejected.'
            : 'Finding reopened \u2014 back to pending.',
      );
      setComments((c) => ({ ...c, [vars.id]: '' }));
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Decision failed'),
  });

  const meta = data?.meta as
    | { total?: number; runId?: number | null; tally?: Record<ReviewStatus, number> }
    | undefined;
  const items = data?.data ?? [];

  if (!isLoading && !error && meta?.runId == null) {
    return (
      <>
        <PageHeader
          title="Review queue"
          description="Nothing counts as a finding until a person confirms it"
        />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState title="No analysis yet" message="Findings appear here once the analysis has run." />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Nothing counts as a finding until a person confirms it"
        actions={
          !can('review') && (
            <span className="text-xs2 text-ink-3">
              Your role ({user?.roleLabel}) can read the queue but not decide.
            </span>
          )
        }
      />

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
        <Panel
          title={
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`pp-btn pp-btn-sm ${status === f ? 'pp-btn-primary' : ''}`}
                  onClick={() => {
                    setStatus(f);
                    setPage(0);
                  }}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== 'all' && ` (${meta?.tally?.[f as ReviewStatus] ?? 0})`}
                </button>
              ))}
            </div>
          }
          actions={
            <div className="flex items-center gap-3">
              <span className="pp-sub">{meta?.total ?? 0} items</span>
              <Pager page={page} perPage={50} total={meta?.total ?? 0} onPage={setPage} />
            </div>
          }
        >
          {isLoading && <SkeletonTable rows={6} cols={5} />}
          {error && <ErrorState error={error} onRetry={refetch} />}

          {!isLoading && !error && !items.length && (
            <div className="pp-empty">
              <b>Queue clear</b>
              Nothing {status === 'all' ? '' : status} right now.
            </div>
          )}

          {!!items.length && (
            <div className="overflow-x-auto">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="w-[94px]">Framework</th>
                    <th>Finding</th>
                    <th className="w-[100px]">Coverage</th>
                    <th className="w-[230px]">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => (
                    <tr key={m.id}>
                      <td><FrameworkPill framework={m.regulation.framework} /></td>
                      <td>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => setOpenId(m.id)}
                        >
                          {m.regulation.title}
                        </button>
                        <div className="font-mono text-tiny text-ink-3">
                          {m.regulation.citation} &middot;{' '}
                          {m.policy && m.status !== 'no_policy' && m.status !== 'not_addressed'
                            ? `${m.policy.code || m.policy.title} @ ${formatPct(m.score)}`
                            : 'no match'}
                        </div>

                        {m.needsRereview && (
                          <div className="mt-1.5 text-[12px] text-flag">
                            Needs re-review — was {m.needsRereview.review}, the conclusion has changed since
                            {m.regulation.amendedAt
                              ? `. The requirement text was amended ${m.regulation.amendedAt}.`
                              : '.'}
                          </div>
                        )}

                        {m.analysisMethod === 'semantic' && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="pp-pill pp-pill-up">AI finding</span>
                            {typeof m.aiConfidence === 'number' && (
                              <span className="text-tiny text-ink-3">
                                confidence {(m.aiConfidence * 100).toFixed(0)}% &middot; awaiting human review
                              </span>
                            )}
                          </div>
                        )}

                        {m.analysisMethod === 'semantic' && m.aiExplanation && (
                          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                            {m.aiExplanation}
                          </p>
                        )}

                        {m.advice && (
                          <div className="pp-advice">
                            <b>{m.advice.head}</b>
                            <div className="mt-0.5">{m.advice.body}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="pp-btn pp-btn-sm"
                                onClick={() => setOpenId(m.id)}
                              >
                                Evidence
                              </button>
                            </div>
                          </div>
                        )}

                        {m.reviewComment && (
                          <div className="mt-1.5 text-xs2 text-ink-3">
                            &ldquo;{m.reviewComment}&rdquo; — {m.reviewedByName}
                          </div>
                        )}

                        {can('review') && m.reviewStatus === 'pending' && (
                          <div className="mt-2">
                            <textarea
                              className={`pp-textarea text-[12.5px] ${rejectError[m.id] ? 'border-flag' : ''}`}
                              rows={2}
                              placeholder={
                                rejectError[m.id] ?? 'Optional note. A comment is required to reject a finding.'
                              }
                              value={comments[m.id] ?? ''}
                              onChange={(e) => {
                                setComments((c) => ({ ...c, [m.id]: e.target.value }));
                                setRejectError((r) => ({ ...r, [m.id]: '' }));
                              }}
                            />
                          </div>
                        )}
                      </td>
                      <td><CoveragePill status={m.status} /></td>
                      <td>
                        {m.reviewStatus === 'pending' ? (
                          can('review') ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="pp-btn pp-btn-sm pp-btn-ok"
                                disabled={decide.isPending}
                                onClick={() =>
                                  decide.mutate({
                                    id: m.id,
                                    action: 'approve',
                                    comment: comments[m.id]?.trim() || undefined,
                                  })
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="pp-btn pp-btn-sm pp-btn-no"
                                disabled={decide.isPending}
                                onClick={() => {
                                  const c = comments[m.id]?.trim();
                                  if (!c) {
                                    setRejectError((r) => ({
                                      ...r,
                                      [m.id]: 'A comment is required to reject a finding.',
                                    }));
                                    return;
                                  }
                                  decide.mutate({ id: m.id, action: 'reject', comment: c });
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <ReviewPill status="pending" />
                          )
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <ReviewPill status={m.reviewStatus} />
                            {can('review') && (
                              <button
                                type="button"
                                className="pp-btn pp-btn-sm"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: m.id, action: 'reopen' })}
                              >
                                Undo
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <EvidenceDrawer mappingId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}
