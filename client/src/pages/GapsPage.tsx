import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COVERAGE_LABEL, FLAG_LABEL, FindingFlag, GapDto, Priority } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import {
  CoveragePill,
  Drawer,
  EmptyState,
  ErrorState,
  formatPct,
  FrameworkPill,
  Loading,
  PageHeader,
  Pager,
  Panel,
  PriorityPill,
} from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

function DraftDrawer({ gapId, onClose }: { gapId: number | null; onClose: () => void }) {
  const { can } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();

  // The generated text is a scaffold. Edits to it are real work and must
  // survive closing the panel, so they are persisted against the gap.
  const saveDraft = useMutation({
    mutationFn: async (vars: { id: number; draftLanguage: string }) =>
      (await api.patch(`/api/gaps/${vars.id}`, { draftLanguage: vars.draftLanguage })).data,
    onSuccess: async () => {
      toast('Draft saved.');
      await queryClient.invalidateQueries({ queryKey: ['gap-draft'] });
      await queryClient.invalidateQueries({ queryKey: ['gaps'] });
    },
    onError: (err) =>
      errorToast(err instanceof ApiClientError ? err.message : 'Could not save the draft'),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['gap-draft', gapId],
    queryFn: async () =>
      (
        await api.get<{
          id: number;
          citation: string;
          title: string;
          framework: string;
          priority: Priority;
          owner: string;
          draft: string;
          note: string;
          /** Named so the drawer can say which document to amend. */
          targetPolicyCode: string | null;
          targetPolicyTitle: string | null;
          recommendedAction: string;
          uncoveredProvisions: string[];
          steps: string[];
        }>(`/api/gaps/${gapId}/draft`)
      ).data,
    enabled: gapId !== null,
  });

  const [text, setText] = useState('');
  const value = text || data?.draft || '';

  return (
    <Drawer
      open={gapId !== null}
      onClose={() => {
        setText('');
        onClose();
      }}
      eyebrow={
        data && (
          <>
            <FrameworkPill framework={data.framework} />
            <PriorityPill priority={data.priority} />
          </>
        )
      }
      title="Draft language"
      subtitle={data ? `${data.citation} \u00b7 ${data.title}` : undefined}
    >
      {isLoading && <Loading />}
      {data && (
        <>
          <p className="mb-3 text-xs2 text-ink-3">{data.note}</p>
          {value !== (data.draft ?? '') && (
            <div className="pp-note mb-3">
              You have unsaved edits. Save the draft to keep them &mdash; closing this panel discards
              anything unsaved.
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="pp-btn pp-btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(value);
                toast('Draft copied to the clipboard.');
              }}
            >
              Copy
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-sm"
              onClick={() => {
                const blob = new Blob([value], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${data.citation.replace(/[^\w.-]+/g, '-')}-draft.txt`;
                a.click();
                URL.revokeObjectURL(url);
                toast('Draft downloaded.');
              }}
            >
              Download .txt
            </button>

            {can('edit') && (
              <button
                type="button"
                className="pp-btn pp-btn-sm pp-btn-primary"
                disabled={saveDraft.isPending || value === (data.draft ?? '')}
                onClick={() => saveDraft.mutate({ id: data.id, draftLanguage: value })}
              >
                {saveDraft.isPending
                  ? 'Saving\u2026'
                  : value === (data.draft ?? '')
                    ? 'Saved'
                    : 'Save draft'}
              </button>
            )}
          </div>
          <textarea
            className="pp-textarea font-mono text-[12.5px]"
            rows={24}
            value={value}
            onChange={(e) => setText(e.target.value)}
          />
          {!!data.uncoveredProvisions?.length && (
            <>
              <div className="pp-label mb-1.5 mt-5">What this draft has to cover</div>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {data.uncoveredProvisions.map((p: string, i: number) => (
                  <li
                    key={i}
                    className="rounded-r border-l-2 border-flag bg-flag-bg py-2 pl-3 pr-2 text-[13px] leading-snug text-[#5E2317]"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="pp-label mb-1.5 mt-5">How to close this gap</div>
          <ol className="m-0 space-y-2 pl-5 text-[13px] text-ink-2">
            <li>
              Edit the draft above so it matches your document conventions, then press{' '}
              <b className="font-medium">Save draft</b> to keep your wording.
            </li>
            <li>
              {data.targetPolicyCode ? (
                <>
                  Open <b className="font-medium">{data.targetPolicyCode}</b>
                  {data.targetPolicyTitle ? ` — ${data.targetPolicyTitle}` : ''} under Policies and add
                  this language to it. Amending the closest policy is usually better than creating a new
                  one.
                </>
              ) : (
                <>
                  Create a new policy under <b className="font-medium">Policies → New policy</b> and paste
                  this language in. No existing document covers this subject.
                </>
              )}
            </li>
            <li>Save the policy, which creates a new version and records who changed it.</li>
            <li>
              Re-run the analysis. If the wording covers the provisions above, this requirement leaves the
              gap list.
            </li>
            <li>
              The finding returns to the review queue as <b className="font-medium">pending</b>, because
              the conclusion changed and needs confirming again.
            </li>
          </ol>

          {!!data.steps?.length && (
            <>
              <div className="pp-label mb-1.5 mt-5">Recommended remediation steps</div>
              <ul className="m-0 space-y-1 pl-5 text-[13px] text-ink-2">
                {data.steps.map((st: string, i: number) => (
                  <li key={i}>{st}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Drawer>
  );
}

export default function GapsPage() {
  const { can } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [priority, setPriority] = useState('');
  // Arriving from the mapping table focuses a single requirement.
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedRegulationId = Number(searchParams.get('regulationId')) || null;
  const [draftId, setDraftId] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['gaps', page, priority, focusedRegulationId],
    queryFn: async () =>
      await api.get<GapDto[]>('/api/gaps', {
        page,
        perPage: 25,
        priority,
        regulationId: focusedRegulationId ?? undefined,
      }),
  });

  const openTracking = useMutation({
    mutationFn: async (gapId: number) => (await api.post('/api/remediation', { gapId })).data,
    onSuccess: () => {
      toast('Tracked. The gap now shows its owner and due date on this card.');
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not open the item'),
  });

  const bulkOpen = useMutation({
    mutationFn: async () => (await api.post<unknown>('/api/remediation/bulk-open')).meta,
    onSuccess: (meta) => {
      toast(`${(meta as { created?: number })?.created ?? 0} remediation item(s) created.`);
      queryClient.invalidateQueries();
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not open items'),
  });

  const meta = data?.meta as
    | { total?: number; byPriority?: Record<Priority, number>; runId?: number | null }
    | undefined;
  const gaps = data?.data ?? [];

  if (!isLoading && !error && meta?.runId == null) {
    return (
      <>
        <PageHeader title="Gaps" description="What is uncovered, and what to do about each one" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState title="No analysis yet" message="Run the analysis to surface uncovered requirements." />
        </div>
      </>
    );
  }

  if (!isLoading && !error && !gaps.length && !priority) {
    return (
      <>
        <PageHeader title="Gaps" description="What is uncovered, and what to do about each one" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState
            title="No gaps found"
            message="Every applicable requirement in this run has a policy that covers it."
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Gaps"
        description="What is uncovered, and what to do about each one"
        actions={
          can('edit') && (
            <button
              type="button"
              className="pp-btn"
              disabled={bulkOpen.isPending}
              onClick={() => bulkOpen.mutate()}
            >
              {bulkOpen.isPending ? 'Opening\u2026' : 'Track all gaps'}
            </button>
          )
        }
      />

      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        {focusedRegulationId && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel px-3.5 py-2.5">
            <span className="pp-pill pp-pill-up">showing one requirement</span>
            <span className="text-xs2 text-ink-3">
              Opened from the mapping table. The other gaps are still here.
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className="pp-btn pp-btn-sm"
              onClick={() => {
                searchParams.delete('regulationId');
                setSearchParams(searchParams, { replace: true });
                setPage(0);
              }}
            >
              Show all gaps
            </button>
          </div>
        )}

        <Panel
          title={`${meta?.total ?? 0} requirements need attention`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {(['Critical', 'High', 'Medium'] as Priority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPriority(priority === p ? '' : p);
                    setPage(0);
                  }}
                  className={`pp-pill ${p === 'Critical' ? 'pp-pill-gap' : p === 'High' ? 'pp-pill-par' : 'pp-pill-fw'} ${
                    priority === p ? 'ring-2 ring-ink ring-offset-1' : ''
                  }`}
                >
                  {meta?.byPriority?.[p] ?? 0} {p.toLowerCase()}
                </button>
              ))}
              <Pager page={page} perPage={25} total={meta?.total ?? 0} onPage={setPage} />
            </div>
          }
        >
          <div className="pp-pad text-xs2 text-ink-3">
            Each item says what to do, who should own it, and gives draft policy language you can lift straight
            into your document. Priority weighs the framework&rsquo;s enforcement risk against how far short the
            coverage falls.
          </div>
        </Panel>

        {isLoading && <Loading />}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {gaps.map((g) => (
          <Panel
            key={g.id}
            title={
              <span className="block">
                <span className="mb-1.5 flex flex-wrap gap-1.5">
                  <PriorityPill priority={g.priority} />
                  <FrameworkPill framework={g.regulation.framework} />
                  <CoveragePill status={g.coverageStatus} />
                  {g.flags.map((f) => (
                    <span key={f} className={`pp-pill ${f === 'conflict' ? 'pp-pill-gap' : 'pp-pill-par'}`}>
                      {FLAG_LABEL[f as FindingFlag]}
                    </span>
                  ))}
                  {g.remediation && (
                    <span className="pp-pill pp-pill-up">tracked · {g.remediation.status}</span>
                  )}
                </span>
                <span className="text-[16px]">{g.regulation.title}</span>
              </span>
            }
            sub={
              <span className="font-mono">
                {g.regulation.citation} &middot; current match {formatPct(g.score)}
              </span>
            }
            actions={
              <button
                type="button"
                className="pp-btn pp-btn-sm pp-btn-primary"
                disabled={openTracking.isPending}
                title={
                  g.remediation
                    ? 'Open the draft policy language for this gap'
                    : 'Opens the draft language and starts tracking this gap'
                }
                onClick={() => {
                  setDraftId(g.id);
                  // Opening the draft means work has started, so record it -
                  // unless it is already tracked.
                  if (can('edit') && !g.remediation) openTracking.mutate(g.id);
                }}
              >
                {g.remediation ? 'Open draft' : 'Work on this'}
              </button>
            }
          >
            <div className="grid lg:grid-cols-[1fr_1.25fr_1.15fr]">
              <div className="border-b border-line-2 p-4 lg:border-b-0 lg:border-r">
                <div className="pp-label mb-1">Recommended action</div>
                <div className="font-medium">{g.action}</div>
                <div className="mt-0.5 text-xs2 text-ink-3">
                  {g.targetPolicyCode
                    ? `Target: ${g.targetPolicyCode} v${g.targetPolicyVersion}`
                    : 'No existing policy is close enough to amend.'}
                </div>

                <div className="pp-label mb-1 mt-4">Suggested owner</div>
                <div>{g.owner}</div>

                <div className="pp-label mb-1 mt-4">Effort</div>
                <div>{g.effort}</div>

                <div className="pp-label mb-1 mt-4">If left open</div>
                <div className="text-xs2 text-ink-3">{g.risk}</div>
              </div>

              <div className="border-b border-line-2 p-4 lg:border-b-0 lg:border-r">
                <div className="pp-label mb-1.5">What the policy set does not say</div>
                {g.uncoveredClauses.length ? (
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    {g.uncoveredClauses.map((c, i) => (
                      <li
                        key={i}
                        className="rounded-r border-l-2 border-flag bg-flag-bg py-2 pl-3 pr-2 text-[13px] leading-snug text-[#5E2317]"
                      >
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 text-[13px] text-ink-3">
                    The closest policy touches the same subject but is too thin to demonstrate compliance.
                    Compare the full texts under Mapping.
                  </p>
                )}

                {g.missingTerms.length > 0 && (
                  <>
                    <div className="pp-label mb-1.5 mt-4">Missing terms</div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.missingTerms.map((t) => (
                        <span key={t} className="pp-pill pp-pill-gap">
                          {t}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="p-4">
                <div className="pp-label mb-1.5">Steps to close it</div>
                <ol className="m-0 list-decimal space-y-1.5 pl-5 text-[13px] leading-snug">
                  {g.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <DraftDrawer gapId={draftId} onClose={() => setDraftId(null)} />
    </>
  );
}
