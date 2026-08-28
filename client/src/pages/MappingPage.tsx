import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AI_STATUS_LABEL,
  isOpen,
  AnalysisRunDto,
  COVERAGE_LABEL,
  COVERAGE_STATUSES,
  FLAG_LABEL,
  FindingFlag,
  MappingDto,
} from '@policy-prism/shared';
import { api } from '@/api/client';
import {
  CoveragePill,
  Drawer,
  EmptyState,
  ErrorState,
  FrameworkPill,
  Highlighted,
  PageHeader,
  Pager,
  Panel,
  ReviewPill,
  SkeletonTable,
  formatPct,
} from '@/components/ui';

export function EvidenceDrawer({ mappingId, onClose }: { mappingId: number | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mapping', mappingId],
    queryFn: async () =>
      (
        await api.get<{
          mapping: MappingDto;
          gap: {
            id: number;
            priority: string;
            action: string;
            effort: string;
            owner: string;
            risk: string;
            steps: string[];
            uncoveredClauses: string[];
            missingTerms: string[];
            draft: string;
          } | null;
        }>(`/api/analysis/mapping/${mappingId}`)
      ).data,
    enabled: mappingId !== null,
  });

  const m = data?.mapping;

  return (
    <Drawer
      open={mappingId !== null}
      onClose={onClose}
      eyebrow={
        m && (
          <>
            <FrameworkPill framework={m.regulation.framework} />
            <CoveragePill status={m.status} />
            {m.flags.map((f) => (
              <span key={f} className={`pp-pill ${f === 'conflict' ? 'pp-pill-gap' : 'pp-pill-par'}`}>
                {FLAG_LABEL[f as FindingFlag]}
              </span>
            ))}
          </>
        )
      }
      title={m?.regulation.title ?? 'Evidence'}
      subtitle={m ? `${m.regulation.citation} \u00b7 match ${formatPct(m.score)}` : undefined}
    >
      {isLoading && <SkeletonTable rows={6} cols={5} />}
      {m && (
        <div className="space-y-5">
          {/* ---- how this finding was reached ---- */}
          {m.analysisMethod === 'semantic' ? (
            <div className="rounded border border-auto bg-auto-bg px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="pp-pill pp-pill-up">AI semantic analysis</span>
                {typeof m.aiConfidence === 'number' && (
                  <span className="text-xs2 text-ink-2">
                    confidence {(m.aiConfidence * 100).toFixed(0)}%
                  </span>
                )}
                {m.aiStatus && (
                  <span className="text-xs2 text-ink-3">
                    &middot; {AI_STATUS_LABEL[m.aiStatus] ?? m.aiStatus}
                  </span>
                )}
              </div>
              {m.aiExplanation && (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{m.aiExplanation}</p>
              )}
              <p className="mt-2 text-tiny text-ink-3">
                {m.aiModel ? `Model: ${m.aiModel}. ` : ''}
                An AI-generated finding. It is not a compliance determination and requires human
                review.
              </p>
            </div>
          ) : (
            <div className="pp-note">
              {m.aiFallbackReason ??
                'This finding was reached by comparing policy wording against the requirement, without AI semantic analysis.'}
            </div>
          )}

          {/* ---- supporting evidence ---- */}
          {!!m.aiEvidence?.length && (
            <div>
              <div className="pp-label mb-1.5">Supporting evidence</div>
              {m.aiEvidence.map((e, i) => (
                <div key={i} className="mb-2 rounded border border-line-2 bg-panel-2 px-3 py-2.5">
                  <div className="font-mono text-tiny text-ink-3">
                    {e.policyCode || e.policyTitle} v{e.policyVersion} &middot; {e.sectionLabel}
                  </div>
                  <blockquote className="mt-1.5 border-l-2 border-seal pl-3 text-[13px] leading-relaxed">
                    &ldquo;{e.quote}&rdquo;
                  </blockquote>
                </div>
              ))}
              <p className="text-tiny text-ink-3">
                Each quotation was verified to appear in the cited policy section before this
                finding was stored.
              </p>
            </div>
          )}

          {!!m.aiMissingProvisions?.length && (
            <div>
              <div className="pp-label mb-1.5">Provisions the policy does not state</div>
              <ul className="m-0 list-none space-y-1.5 p-0">
                {m.aiMissingProvisions.map((p, i) => (
                  <li
                    key={i}
                    className="rounded-r border-l-2 border-flag bg-flag-bg py-2 pl-3 pr-2 text-[13px] leading-snug text-[#5E2317]"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!m.aiContradictions?.length && (
            <div>
              <div className="pp-label mb-1.5">Contradictory evidence</div>
              <div className="pp-note pp-note-bad">
                {m.aiContradictions.map((c, i) => (
                  <div key={i} className={i ? 'mt-1.5' : ''}>
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="pp-label mb-1.5">Requirement text</div>
            <div className="pp-quote">
              <Highlighted text={m.regulation.requirementText} terms={m.matchedTerms} />
            </div>
          </div>

          {m.policy ? (
            <div>
              <div className="pp-label mb-1.5">
                Matched policy — {m.policy.code || m.policy.title} v{m.policy.version}
              </div>
              <div className="mb-1.5 text-xs2 text-ink-3">
                {m.policy.title} &middot; owner {m.policy.owner} &middot; effective{' '}
                {m.policy.effectiveDate ?? 'unset'}
              </div>
              <div className="pp-quote">
                <Highlighted text={m.policy.text} terms={m.matchedTerms} />
              </div>
            </div>
          ) : (
            <div className="pp-note pp-note-bad">
              No policy in the library is close enough to this requirement to be treated as a match.
            </div>
          )}

          {m.contradictoryTerms.length > 0 && (
            <div>
              <div className="pp-label mb-1.5">Terms used in a negative statement</div>
              <div className="pp-note pp-note-bad mb-2">
                The policy uses this requirement&rsquo;s vocabulary inside a negation. Read it before deciding —
                high overlap can come from a policy that says the opposite.
              </div>
              <div className="flex flex-wrap gap-1.5">
                {m.contradictoryTerms.map((t) => (
                  <span key={t} className="pp-pill pp-pill-gap">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {m.missingTerms.length > 0 && (
            <div>
              <div className="pp-label mb-1.5">Requirement vocabulary absent from the policy</div>
              <div className="flex flex-wrap gap-1.5">
                {m.missingTerms.map((t) => (
                  <span key={t} className="pp-pill pp-pill-par">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {m.joint && (
            <div>
              <div className="pp-label mb-1.5">Covered jointly</div>
              <p className="text-xs2 text-ink-2">
                No single policy clears the bar, but {m.joint.policyIds.length} policies together reach{' '}
                {formatPct(m.joint.score)}. A surveyor would expect one document to answer the obligation, so
                this is surfaced rather than counted as covered.
              </p>
            </div>
          )}

          {m.alternatives.length > 0 && (
            <div>
              <div className="pp-label mb-1.5">Other policies that touch this subject</div>
              {m.alternatives.map((a) => (
                <div
                  key={a.policyId}
                  className="flex items-baseline justify-between gap-3 border-b border-line-2 py-2 last:border-b-0"
                >
                  <span className="text-[13px]">{a.policyTitle ?? `Policy ${a.policyId}`}</span>
                  <span className="font-mono text-tiny text-ink-3">{formatPct(a.score)}</span>
                </div>
              ))}
            </div>
          )}

          {data?.gap && (
            <div>
              <div className="pp-label mb-1.5">Recommended action</div>
              <div className="text-[13px] font-medium">{data.gap.action}</div>
              <div className="mt-0.5 text-xs2 text-ink-3">
                {data.gap.effort} &middot; suggested owner {data.gap.owner}
              </div>
              <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-[13px]">
                {data.gap.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}

          <div>
            <div className="pp-label mb-1.5">Review</div>
            <div className="flex items-center gap-2">
              <ReviewPill status={m.reviewStatus} />
              {m.reviewedByName && <span className="text-xs2 text-ink-3">by {m.reviewedByName}</span>}
            </div>
            {m.reviewComment && (
              <p className="mt-1.5 text-xs2 text-ink-3">&ldquo;{m.reviewComment}&rdquo;</p>
            )}
            {m.needsRereview && (
              <div className="pp-note pp-note-bad mt-2">
                Needs re-review — was {m.needsRereview.review} when the conclusion was{' '}
                {m.needsRereview.was}.
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default function MappingPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [framework, setFramework] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: run } = useQuery({
    queryKey: ['analysis', 'latest'],
    queryFn: async () => (await api.get<AnalysisRunDto | null>('/api/analysis/latest')).data,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mappings', run?.id, page, q, framework, status],
    queryFn: async () =>
      await api.get<MappingDto[]>(`/api/analysis/${run!.id}/mappings`, {
        page,
        perPage: 100,
        q,
        framework,
        status,
      }),
    enabled: !!run,
  });

  if (!run) {
    return (
      <>
        <PageHeader title="Mapping" description="Every requirement, its best-matching policy and the evidence" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState
            title="No analysis yet"
            message="Run the analysis to see how each requirement maps to policy."
          />
        </div>
      </>
    );
  }

  const meta = data?.meta as { total?: number; frameworks?: string[] } | undefined;
  const rows = data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Mapping"
        description="Every requirement, its best-matching policy and the evidence"
      />

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
        <Panel
          title={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="pp-input w-[280px]"
                placeholder="Search requirement or policy"
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
                {(meta?.frameworks ?? []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                className="pp-select w-auto"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All statuses</option>
                {COVERAGE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {COVERAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          }
          actions={
            <div className="flex items-center gap-3">
              <span className="pp-sub">
                {meta?.total ?? 0} of {run.requirementCount}
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
                    <th>Requirement</th>
                    <th>Best matching policy</th>
                    <th className="w-[78px]">Match</th>
                    <th className="w-[100px]">Coverage</th>
                    <th className="w-[92px]">Review</th>
                    <th className="w-[92px]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="pp-row-click" onClick={() => setOpenId(m.id)}>
                      <td><FrameworkPill framework={m.regulation.framework} /></td>
                      <td>
                        <b className="font-medium">{m.regulation.title}</b>
                        <div className="pp-cite">{m.regulation.citation}</div>
                      </td>
                      <td>
                        {m.policy && m.status !== 'no_policy' && m.status !== 'not_addressed' ? (
                          <>
                            {m.policy.title}
                            <div className="font-mono text-tiny text-ink-3">
                              {m.policy.code} v{m.policy.version}
                            </div>
                          </>
                        ) : (
                          <span className="text-ink-3">No adequate match</span>
                        )}
                      </td>
                      <td className="font-mono">{formatPct(m.score)}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <CoveragePill status={m.status} />
                          {m.analysisMethod === 'semantic' && (
                            <span
                              className="pp-badge pp-badge-ai"
                              title={`AI semantic analysis${
                                typeof m.aiConfidence === 'number'
                                  ? ` \u00b7 confidence ${(m.aiConfidence * 100).toFixed(0)}%`
                                  : ''
                              }`}
                            >
                              AI
                            </span>
                          )}
                        </span>
                      </td>
                      <td><ReviewPill status={m.reviewStatus} /></td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {isOpen(m.status) ? (
                          <button
                            type="button"
                            className="pp-btn pp-btn-sm"
                            title="Open the remediation plan for this requirement"
                            onClick={() => navigate(`/gaps?regulationId=${m.regulationId}`)}
                          >
                            View gap
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={7} className="pp-empty">
                        Nothing matches those filters.
                      </td>
                    </tr>
                  )}
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
