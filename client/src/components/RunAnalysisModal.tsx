import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { ANALYSIS_STEPS, PolicyDto, RegulationDto } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import { Loading, Modal } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

type Mode = 'full' | 'policies' | 'frameworks';

/**
 * Lets the user narrow what a run covers, rather than always scoring the whole
 * library. Selecting policies alone narrows the requirement set to what those
 * policies speak to, so a targeted run does not report every untouched
 * requirement as a gap.
 */
export default function RunAnalysisModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>('full');
  const [policyIds, setPolicyIds] = useState<number[]>([]);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [step, setStep] = useState<string | null>(null);

  const { data: policies, isLoading: loadingPolicies } = useQuery({
    queryKey: ['policies', 'all-for-run'],
    queryFn: async () =>
      (await api.get<PolicyDto[]>('/api/policies', { perPage: 200, scope: 'regulatory' })).data,
    enabled: open,
  });

  const { data: regulations, isLoading: loadingRegs } = useQuery({
    queryKey: ['regulations', 'in-scope-for-run'],
    queryFn: async () =>
      (await api.get<RegulationDto[]>('/api/regulations', { perPage: 200, scope: 'in' })).data,
    enabled: open,
  });

  const frameworkList = useMemo(() => {
    const counts = new Map<string, number>();
    (regulations ?? []).forEach((r) => counts.set(r.framework, (counts.get(r.framework) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [regulations]);

  const selectedRegulationIds = useMemo(
    () => (regulations ?? []).filter((r) => frameworks.includes(r.framework)).map((r) => r.id),
    [regulations, frameworks],
  );

  const run = useMutation({
    mutationFn: async () => {
      try {
        sessionStorage.setItem('pp_run_origin', location.pathname);
      } catch {
        /* storage unavailable */
      }
      let i = 0;
      const timer = setInterval(() => {
        setStep(ANALYSIS_STEPS[Math.min(i++, ANALYSIS_STEPS.length - 1)]);
      }, 220);
      try {
        const body =
          mode === 'policies'
            ? { trigger: 'Manual run', policyIds, policyScoped: true }
            : mode === 'frameworks'
              ? { trigger: 'Manual run', regulationIds: selectedRegulationIds }
              : { trigger: 'Manual run' };
        return (
          await api.post<{
            run: {
              id: number;
              covered: number;
              partial: number;
              notAddressed: number;
              noPolicy: number;
              durationMs: number;
            };
          }>('/api/analysis/run', body)
        ).data;
      } finally {
        clearInterval(timer);
        setStep(null);
      }
    },
    onSuccess: async (data) => {
      const r = data.run;
      toast(
        `${r.covered} covered \u00b7 ${r.partial} partial \u00b7 ${r.notAddressed + r.noPolicy} gaps in ${r.durationMs} ms`,
      );
      await queryClient.invalidateQueries();
      onClose();
      navigate('/dashboard', { state: { from: location.pathname } });
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Analysis failed'),
  });

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const canRun =
    mode === 'full' ||
    (mode === 'policies' && policyIds.length > 0) ||
    (mode === 'frameworks' && selectedRegulationIds.length > 0);

  const summary =
    mode === 'full'
      ? `${regulations?.length ?? 0} requirements \u00d7 ${policies?.length ?? 0} policies`
      : mode === 'policies'
        ? `${policyIds.length} polic${policyIds.length === 1 ? 'y' : 'ies'}, requirements narrowed to what they address`
        : `${selectedRegulationIds.length} requirements across ${frameworks.length} framework(s)`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Run analysis"
      description="Choose what this run covers. Every run is saved as its own snapshot."
      width="min(640px,100%)"
      footer={
        <>
          <span className="mr-auto text-xs2 text-ink-3">{summary}</span>
          <button type="button" className="pp-btn" onClick={onClose} disabled={run.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="pp-btn pp-btn-primary"
            disabled={!canRun || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? step ?? 'Analyzing\u2026' : 'Run analysis'}
          </button>
        </>
      }
    >
      <div className="space-y-2.5">
        {(
          [
            ['full', 'Full library', 'Every requirement that applies to this facility, against every regulatory policy.'],
            ['policies', 'Selected policies', 'Check specific policies. Requirements are narrowed to the subjects those policies address, so untouched areas are not reported as gaps.'],
            ['frameworks', 'Selected frameworks', 'Limit the run to one or more frameworks, e.g. only CMS and EMTALA.'],
          ] as Array<[Mode, string, string]>
        ).map(([key, label, blurb]) => (
          <label
            key={key}
            className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
              mode === key ? 'border-seal bg-seal-bg' : 'border-line'
            }`}
          >
            <input
              type="radio"
              name="run-mode"
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

      {mode === 'policies' && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="pp-label">Policies ({policyIds.length} selected)</span>
            <span className="flex gap-2">
              <button
                type="button"
                className="pp-btn pp-btn-sm"
                onClick={() => setPolicyIds((policies ?? []).map((p) => p.id))}
              >
                All
              </button>
              <button type="button" className="pp-btn pp-btn-sm" onClick={() => setPolicyIds([])}>
                None
              </button>
            </span>
          </div>
          {loadingPolicies ? (
            <Loading />
          ) : (
            <div className="max-h-[280px] overflow-y-auto rounded border border-line">
              {(policies ?? []).map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-line-2 px-3 py-2 text-[13px] last:border-b-0 hover:bg-panel-2"
                >
                  <input
                    type="checkbox"
                    checked={policyIds.includes(p.id)}
                    onChange={() => toggle(policyIds, p.id, setPolicyIds)}
                  />
                  <span className="font-mono text-tiny text-ink-3">{p.code || '—'}</span>
                  <span className="flex-1">{p.title}</span>
                  <span className="text-tiny text-ink-3">v{p.version}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'frameworks' && (
        <div className="mt-4">
          <div className="pp-label mb-2">Frameworks ({frameworks.length} selected)</div>
          {loadingRegs ? (
            <Loading />
          ) : (
            <div className="flex flex-wrap gap-2">
              {frameworkList.map(([f, n]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggle(frameworks, f, setFrameworks)}
                  className={`pp-btn pp-btn-sm ${frameworks.includes(f) ? 'pp-btn-primary' : ''}`}
                >
                  {f} ({n})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-4 text-tiny text-ink-3">
        A narrowed run produces different totals from a full run, so the dashboard marks it as a
        selection rather than plotting it against full-library history.
      </p>
    </Modal>
  );
}
