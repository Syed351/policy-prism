import { useQuery } from '@tanstack/react-query';
import { AnalysisRunDto, PolicyCheckDto } from '@policy-prism/shared';
import { api } from '@/api/client';
import {
  CoveragePill,
  EmptyState,
  ErrorState,
  formatPct,
  FrameworkPill,
  Loading,
  PageHeader,
  Panel,
} from '@/components/ui';

const VERDICT_PILL: Record<PolicyCheckDto['verdict'], string> = {
  meets: 'pp-pill-cov',
  partly: 'pp-pill-par',
  insufficient: 'pp-pill-gap',
  unmatched: 'pp-pill-pen',
};

export default function PolicyCheckPage() {
  const { data: run } = useQuery({
    queryKey: ['analysis', 'latest'],
    queryFn: async () => (await api.get<AnalysisRunDto | null>('/api/analysis/latest')).data,
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['policy-check', run?.id],
    queryFn: async () => (await api.get<PolicyCheckDto[]>(`/api/analysis/${run!.id}/policy-check`)).data,
    enabled: !!run,
  });

  if (!run) {
    return (
      <>
        <PageHeader title="Policy check" description="Each policy against the requirements it addresses" />
        <div className="flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <EmptyState
            title="No analysis yet"
            message="Run the analysis, then this tab reports each policy against the requirements it addresses."
          />
        </div>
      </>
    );
  }

  const tally = (data ?? []).reduce<Record<string, number>>((acc, p) => {
    acc[p.verdict] = (acc[p.verdict] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Policy check"
        description="Each policy against the requirements it addresses"
        actions={
          <div className="flex flex-wrap gap-1.5">
            <span className="pp-pill pp-pill-cov">{tally.meets ?? 0} meets</span>
            <span className="pp-pill pp-pill-par">{tally.partly ?? 0} partly</span>
            <span className="pp-pill pp-pill-gap">{tally.insufficient ?? 0} insufficient</span>
            <span className="pp-pill pp-pill-pen">{tally.unmatched ?? 0} unmatched</span>
          </div>
        }
      />

      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        <div className="pp-note">
          A policy is judged on the requirements it owns: those where it is the closest match, or where it
          clears the partial bar. Weak topical overlap is noted as <em>related</em>, not counted against it.
        </div>

        {isLoading && <Loading />}
        {error && <ErrorState error={error} onRetry={refetch} />}

        {(data ?? []).map((p) => (
          <Panel
            key={p.policy.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="pp-pill pp-pill-fw">{p.policy.code || 'policy'}</span>
                <span className={`pp-pill ${VERDICT_PILL[p.verdict]}`}>{p.verdictLabel}</span>
                <span>{p.policy.title}</span>
              </span>
            }
            sub={
              <span className="font-mono">
                v{p.policy.version} &middot; {p.policy.owner} &middot; effective{' '}
                {p.policy.effectiveDate ?? 'unset'}
              </span>
            }
            actions={
              <span className="pp-sub">
                {p.covered} covered &middot; {p.partial} partial &middot; {p.weak} weak
                {p.contra ? ` \u00b7 ${p.contra} contradiction${p.contra > 1 ? 's' : ''}` : ''}
              </span>
            }
          >
            {p.hits.length ? (
              <table className="pp-table">
                <thead>
                  <tr>
                    <th className="w-[94px]">Framework</th>
                    <th>Requirement it answers</th>
                    <th className="w-[78px]">Match</th>
                    <th className="w-[100px]">Coverage</th>
                    <th className="w-[80px]">Closest</th>
                  </tr>
                </thead>
                <tbody>
                  {p.hits.map((h) => (
                    <tr key={`${p.policy.id}-${h.regulationId}`}>
                      <td><FrameworkPill framework={h.framework} /></td>
                      <td>
                        <b className="font-medium">{h.title}</b>
                        <div className="font-mono text-tiny text-ink-3">{h.citation}</div>
                      </td>
                      <td className="font-mono">{formatPct(h.score)}</td>
                      <td><CoveragePill status={h.status} /></td>
                      <td>
                        {h.best ? (
                          <span className="pp-pill pp-pill-fw">best</span>
                        ) : (
                          <span className="text-tiny text-ink-3">secondary</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pp-pad text-xs2 text-ink-3">
                {p.policy.scope === 'regulatory'
                  ? 'This policy is not the closest match for any requirement in this run, and does not clear the partial bar on any. It may be genuinely out of regulatory scope \u2014 consider reclassifying it as operational or governance.'
                  : 'Out of regulatory scope, so it is never force-mapped to a citation.'}
              </div>
            )}

            {p.related.length > 0 && (
              <div className="pp-pad border-t border-line-2">
                <div className="pp-label mb-1.5">Related but too weak to count ({p.related.length})</div>
                <div className="flex flex-wrap gap-1.5">
                  {p.related.slice(0, 12).map((r) => (
                    <span key={r.regulationId} className="pp-pill pp-pill-pen">
                      {r.citation} &middot; {formatPct(r.score)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
