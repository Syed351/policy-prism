import { Fragment, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  COVERAGE_LABEL,
  DashboardDto,
  REVIEW_MONTHS,
  TH_COV,
  TH_PAR,
} from '@policy-prism/shared';
import { api } from '@/api/client';
import {
  CoverageMeter,
  EmptyState,
  ErrorState,
  FrameworkPill,
  Note,
  PageHeader,
  Pager,
  Panel,
  SkeletonStats,
  SkeletonTable,
  Stat,
  formatDateTime,
  formatPct,
} from '@/components/ui';

const STATUS_COLOUR: Record<string, string> = {
  covered: '#1B6048',
  partial: '#8A5A0B',
  not_addressed: '#9E3823',
  no_policy: '#9E3823',
};

/** Sparkline of coverage across comparable runs. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const W = 210;
  const H = 34;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = Math.max(1, hi - lo);
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * (W - 4) + 2,
    H - 2 - ((p - lo) / span) * (H - 8),
  ]);
  const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = xy[xy.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="block">
      <path d={d} fill="none" stroke="#1B6048" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.6" fill="#1B6048" />
    </svg>
  );
}

function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="text-ink-3">first run</span>;
  if (value === 0) return <span className="text-ink-3">no change</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`pp-pill ${good ? 'pp-pill-cov' : 'pp-pill-gap'}`}>
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
}

const PAGE_NAME: Record<string, string> = {
  '/regulations': 'Regulations',
  '/policies': 'Policies',
  '/facility': 'Facility profile',
  '/gaps': 'Gaps',
  '/review': 'Review queue',
  '/reports': 'Reports',
  '/mapping': 'Mapping',
  '/policy-check': 'Policy check',
  '/audit': 'Audit trail',
};

/** Where the run was launched from. Survives a reload, unlike router state. */
const ORIGIN_KEY = 'pp_run_origin';

function readOrigin(stateFrom?: string): string | null {
  if (stateFrom) {
    try {
      sessionStorage.setItem(ORIGIN_KEY, stateFrom);
    } catch {
      /* storage unavailable - the link just will not survive a reload */
    }
    return stateFrom;
  }
  try {
    return sessionStorage.getItem(ORIGIN_KEY);
  } catch {
    return null;
  }
}

/** Ten fits on screen without scrolling past the panel. */
const RUNS_PER_PAGE = 10;

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // Which saved run is on screen. Empty means the most recent.
  const [runId, setRunId] = useState<number | ''>('');
  const from = readOrigin((location.state as { from?: string } | null)?.from ?? undefined);
  // Never leave the user stranded: fall back to the requirement library.
  const backTo = from && from !== '/dashboard' ? from : '/regulations';

  // History pages in memory: the runs arrive in one payload, so paging it
  // costs no extra request.
  const [historyPage, setHistoryPage] = useState(0);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', runId],
    queryFn: async () =>
      (await api.get<DashboardDto>('/api/dashboard', runId ? { runId } : undefined)).data,
  });

  if (isLoading) {
    return (
      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        <SkeletonStats count={5} />
        <SkeletonTable rows={5} cols={4} />
      </div>
    );
  }
  if (error) return <div className="p-6"><ErrorState error={error} onRetry={refetch} /></div>;
  if (!data) return null;

  if (!data.hasAnalysis) {
    return (
      <>
        <div className="border-b border-line bg-panel px-6 pt-3">
          <Link to={backTo} className="text-[13px] font-medium text-ink-2 hover:underline">
            &larr; Back to {PAGE_NAME[backTo] ?? 'Regulations'}
          </Link>
        </div>
        <PageHeader title="Coverage" description="Policy coverage against the obligations that apply" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState
            title="No analysis yet"
            message={`Run the analysis to map ${data.policyCount} policies against ${data.inScopeCount} applicable requirements. Use the Run analysis button above.`}
          />
        </div>
      </>
    );
  }

  const c = data.counts;
  const run = data.run!;
  const comparable = data.runs.filter((r) => !r.scopeChanged || r.id === run.id);
  const pagedRuns = data.runs.slice(
    historyPage * RUNS_PER_PAGE,
    historyPage * RUNS_PER_PAGE + RUNS_PER_PAGE,
  );
  const first = comparable[comparable.length - 1] ?? run;

  return (
    <>
      <div className="flex items-center gap-4 border-b border-line bg-panel px-6 pt-3">
        <Link
          to={backTo}
          className="text-[13px] font-medium text-ink-2 hover:underline"
          onClick={() => {
            try {
              sessionStorage.removeItem(ORIGIN_KEY);
            } catch {
              /* nothing to clear */
            }
          }}
        >
          &larr; Back to {PAGE_NAME[backTo] ?? 'Regulations'}
        </Link>
      </div>

      <PageHeader
        title="Coverage"
        description="Policy coverage against the obligations that apply"

      />

      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        {/* ---- run context ---- */}
        <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-panel px-3.5 py-2.5">
          <span className="pp-label">Analysis</span>
          <select
            className="pp-select w-auto min-w-[320px]"
            value={runId === '' ? String(run.id) : String(runId)}
            onChange={(e) => {
              setRunId(Number(e.target.value));
              setHistoryPage(0);
            }}
          >
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {`Run ${r.runNumber} \u00b7 ${r.label} \u00b7 ${formatDateTime(r.createdAt)}`}
              </option>
            ))}
          </select>
          <span className={`pp-pill ${run.scopeKind === 'full' ? 'pp-pill-fw' : 'pp-pill-up'}`}>
            {run.scopeKind === 'full' ? 'FULL LIBRARY' : 'SELECTION'}
          </span>
          <span className="text-xs2 text-ink-3">
            {run.coveragePct}% covered &middot; run by {run.runByName}
          </span>
          <span className="flex-1" />
          {runId !== '' && runId !== data.runs[0]?.id && (
            <button
              type="button"
              className="pp-btn pp-btn-sm"
              onClick={() => {
                setRunId('');
                setHistoryPage(0);
              }}
            >
              Latest run
            </button>
          )}
          {isFetching && <span className="text-xs2 text-ink-3">refreshing\u2026</span>}
          <span className="text-xs2 text-ink-3">{data.runs.length} saved runs</span>
        </div>

        {data.detailAvailable === false && (
          <Note>
            <b>This report&rsquo;s per-requirement detail is no longer available.</b> The requirements it
            analysed have since been replaced, which removes their findings. The totals below are the
            ones recorded when the run completed. Select a more recent run to see the full breakdown.
          </Note>
        )}

        {/* ---- headline stats ---- */}
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            label="Coverage"
            tone="seal"
            value={`${c.coveragePct}%`}
            detail={`${c.covered} of ${c.total} requirements covered`}
          >
            <CoverageMeter covered={c.covered} partial={c.partial} gap={c.gap} total={c.total} />
          </Stat>
          <Stat
            label="Not addressed"
            tone="gap"
            value={c.not_addressed}
            detail="A policy exists on the subject but is silent on this"
          />
          <Stat
            label="No policy"
            tone="gap"
            value={c.no_policy}
            detail="Nothing in the library covers this subject"
          />
          <Stat label="Partial" value={c.partial} detail="Mapped but thin" />
          <Stat
            label="Reviewed"
            tone={c.needsRereview ? 'gap' : undefined}
            value={
              <>
                {c.reviewed}
                <span className="text-[18px] text-ink-3">/{c.total}</span>
              </>
            }
            detail={
              c.needsRereview
                ? `${c.needsRereview} need re-review after a change`
                : `${c.pending} awaiting a decision`
            }
          />
        </div>

        {/* ---- strip + framework breakdown ---- */}
        <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="Coverage by requirement" sub="Bar height = match strength. Click any bar to open Mapping.">
            <div className="flex h-[74px] items-end gap-[2px] px-4 pt-3.5">
              {data.strip.map((s) => (
                <i
                  key={s.regulationId}
                  className="pp-strip-bar"
                  title={`${s.citation} \u2014 ${COVERAGE_LABEL[s.status]} (${formatPct(s.score)})`}
                  onClick={() => navigate('/mapping')}
                  style={{
                    height: `${Math.max(14, Math.round(s.score * 100))}%`,
                    background: STATUS_COLOUR[s.status],
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-4 px-4 pb-3.5 pt-2.5 text-[12px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-seal" />
                Covered ≥ {TH_COV}
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-amber" />
                Partial {TH_PAR}–{TH_COV}
              </span>
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm bg-flag" />
                Gap &lt; {TH_PAR}
              </span>
            </div>
          </Panel>

          <Panel title="By framework">
            {data.byFramework.map((f) => (
              <div key={f.framework} className="border-b border-line-2 px-4 py-3 last:border-b-0">
                <div className="flex items-baseline justify-between gap-2.5">
                  <b className="font-medium">{f.framework}</b>
                  <span className="text-[12px] text-ink-3">
                    {f.covered}/{f.total} covered
                    {f.gap ? ` \u00b7 ${f.gap} gap${f.gap > 1 ? 's' : ''}` : ''}
                  </span>
                </div>
                <CoverageMeter covered={f.covered} partial={f.partial} gap={f.gap} total={f.total} />
              </div>
            ))}
          </Panel>
        </div>

        {/* ---- riskiest + warnings ---- */}
        <Panel title="Highest-risk gaps" sub="Weakest matches first">
            {data.riskiestGaps.length ? (
              <table className="pp-table">
                <tbody>
                  {data.riskiestGaps.map((g) => (
                    <tr key={g.mappingId} className="pp-row-click" onClick={() => navigate('/gaps')}>
                      <td className="w-[1%]"><FrameworkPill framework={g.framework} /></td>
                      <td>
                        <b className="font-medium">{g.title}</b>
                        <div className="pp-cite">{g.citation}</div>
                      </td>
                      <td className="text-right font-mono text-ink-3">{formatPct(g.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pp-pad text-xs2 text-ink-3">No gaps in this run.</div>
            )}
        </Panel>

        {/* ---- history ---- */}
        {data.runs.length > 0 && (
          <Panel
            title="Analysis history"
            sub={`${data.runs.length} run${data.runs.length === 1 ? '' : 's'} for ${run.facilityName}`}
            actions={
              data.runs.length > RUNS_PER_PAGE ? (
                <Pager
                  page={historyPage}
                  perPage={RUNS_PER_PAGE}
                  total={data.runs.length}
                  onPage={setHistoryPage}
                />
              ) : undefined
            }
          >
            {comparable.length > 1 && (
              <div className="flex flex-wrap items-center gap-6 border-b border-line-2 px-4 py-3.5">
                <div>
                  <Sparkline points={comparable.slice().reverse().map((r) => r.coveragePct)} />
                  <div className="mt-1 text-tiny text-ink-3">
                    Coverage across {comparable.length} run(s) on the current scope
                  </div>
                </div>
                <div>
                  <div className="pp-label mb-1">
                    {comparable.length < data.runs.length ? 'Since the last scope change' : 'Since the first run'}
                  </div>
                  <div className="flex items-center gap-2 text-[15px] font-medium">
                    {first.coveragePct}% → {run.coveragePct}%
                    <Delta value={run.coveragePct - first.coveragePct} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    Gaps {first.gaps} → {run.gaps}
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="w-[42px]">Run</th>
                    <th className="w-[140px]">When</th>
                    <th className="w-[120px]">Trigger</th>
                    <th className="w-[92px]">Corpus</th>
                    <th className="w-[92px]">Coverage</th>
                    <th className="w-[110px]">Change</th>
                    <th className="w-[60px]">Gaps</th>
                    <th className="w-[86px]">Gap change</th>
                    <th>Run by</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRuns.map((r) => (
                    <Fragment key={r.id}>
                      {r.scopeChanged && (
                        <tr>
                          <td colSpan={9} className="bg-amber-bg px-4 py-2.5 text-xs2 text-[#6C470A]">
                            <b>Facility profile changed</b>
                            {r.scopeDiff ? ` \u00b7 ${r.scopeDiff}` : ''} — the requirement set is different from
                            here, so the numbers below are not comparable with the ones above.
                          </td>
                        </tr>
                      )}
                      <tr>
                        <td className="font-mono text-ink-3">{r.runNumber}</td>
                        <td className="font-mono text-tiny text-ink-3">{formatDateTime(r.createdAt)}</td>
                        <td>
                          <span
                            className={`pp-pill ${
                              r.trigger === 'Profile change'
                                ? 'pp-pill-par'
                                : r.trigger === 'Document import'
                                  ? 'pp-pill-up'
                                  : 'pp-pill-fw'
                            }`}
                          >
                            {r.trigger}
                          </span>
                        </td>
                        <td className="text-[12px] text-ink-3">
                          {r.requirementCount} × {r.policyCount}
                        </td>
                        <td>
                          <b className="font-medium">{r.coveragePct}%</b>{' '}
                          <span className="text-tiny text-ink-3">
                            {r.covered}/{r.requirementCount}
                          </span>
                        </td>
                        <td>
                          {r.scopeChanged ? (
                            <span className="text-tiny text-ink-3">scope changed</span>
                          ) : (
                            <Delta value={r.coverageDelta} />
                          )}
                        </td>
                        <td className="font-mono">{r.gaps}</td>
                        <td>
                          {r.scopeChanged ? (
                            <span className="text-tiny text-ink-3">—</span>
                          ) : (
                            <Delta value={r.gapDelta} invert />
                          )}
                        </td>
                        <td className="text-ink-3">{r.runByName}</td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* ---- activity ---- */}
        <Panel title="Activity" sub="Most recent entries from the audit trail">
          {data.activity.map((l) => (
            <div key={l.id} className="flex gap-3 border-b border-line-2 px-4 py-2.5 text-xs2 last:border-b-0">
              <time className="w-[52px] shrink-0 font-mono text-tiny text-ink-3">
                {new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </time>
              <span>
                {l.action}
                {l.object && <span className="ml-1.5 font-mono text-tiny text-ink-3">{l.object}</span>}
              </span>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}
