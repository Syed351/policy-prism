import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AnalysisRunDto,
  CoverageCounts,
  PRODUCT_DISCLAIMER,
  REPORT_FORMATS,
  REPORT_KIND_LABEL,
  ReportFormat,
  ReportKind,
} from '@policy-prism/shared';
import { api, downloadFile } from '@/api/client';
import { EmptyState, ErrorState, Loading, Note, PageHeader, Panel } from '@/components/ui';
import { useToast } from '@/hooks/useToast';

interface Summary {
  hasAnalysis: boolean;
  facility: string;
  run?: AnalysisRunDto;
  counts?: CoverageCounts;
  frameworks?: string[];
  policyCounts?: { total: number; regulatory: number; outOfScope: number };
  runCount?: number;
  firstPct?: number;
  latestPct?: number;
  unreviewed?: number;
  needsRereview?: number;
  disclaimer: string;
  kinds: Array<{ key: ReportKind; label: string }>;
  formats: readonly ReportFormat[];
}

const FORMAT_BLURB: Record<ReportFormat, string> = {
  xlsx: 'Column widths set, header frozen and filters on. Opens readable with no resizing.',
  csv: 'Raw comma-separated text for importing into another system. No formatting.',
  pdf: 'A formatted document with the scope, coverage summary and full table. Use this to circulate or file.',
};

const KIND_BLURB: Record<ReportKind, string> = {
  coverage: 'Framework-by-framework summary followed by the full mapping table.',
  mapping: 'Every requirement in the run, its matched policy, match strength, coverage class and review decision.',
  gaps: 'Only the requirements that are not covered, with priority and recommended action.',
  remediation: 'The gap list plus owner, effort, due date, missing terms and uncovered provisions.',
  audit: 'The complete append-only trail for this facility.',
  runs: 'Every analysis run with coverage, gap counts and what changed between them.',
};

export default function ReportsPage() {
  const { toast, errorToast } = useToast();
  const [kind, setKind] = useState<ReportKind>('coverage');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [busy, setBusy] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: async () => (await api.get<Summary>('/api/reports/summary')).data,
  });

  if (isLoading) return <Loading label="Loading report summary\u2026" />;
  if (error) return <div className="p-6"><ErrorState error={error} onRetry={refetch} /></div>;
  if (!data) return null;

  const download = async () => {
    setBusy(true);
    try {
      const name = await downloadFile('/api/reports/export', { kind, format });
      toast(`Downloaded ${name}`);
    } catch (e) {
      errorToast(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const c = data.counts;
  const needsRun = ['coverage', 'mapping', 'gaps', 'remediation'].includes(kind);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Exports and compliance summary, generated from the database"
        actions={
          <button
            type="button"
            className="pp-btn"
            onClick={() =>
              downloadFile('/api/reports/workspace')
                .then((n) => toast(`Downloaded ${n}`))
                .catch((e) => errorToast(e.message))
            }
          >
            Export workspace (JSON)
          </button>
        }
      />

      <div className="flex-1 px-4 py-4 sm:px-6 sm:py-5">
        <div className="grid gap-3.5 lg:grid-cols-[minmax(0,620px)_1fr]">
          <div className="space-y-3.5">
            <Panel title="Build a report">
              <div className="pp-pad space-y-4">
                <div>
                  <div className="pp-label mb-2">Report</div>
                  <div className="space-y-2">
                    {data.kinds.map((k) => (
                      <label
                        key={k.key}
                        className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
                          kind === k.key ? 'border-seal bg-seal-bg' : 'border-line'
                        }`}
                      >
                        <input
                          type="radio"
                          name="kind"
                          className="mt-1"
                          checked={kind === k.key}
                          onChange={() => setKind(k.key)}
                        />
                        <span>
                          <b className="block text-[13px] font-medium">{k.label}</b>
                          <em className="not-italic text-tiny text-ink-3">{KIND_BLURB[k.key]}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="pp-label mb-2">Format</div>
                  <div className="space-y-2">
                    {REPORT_FORMATS.map((f) => (
                      <label
                        key={f}
                        className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
                          format === f ? 'border-seal bg-seal-bg' : 'border-line'
                        }`}
                      >
                        <input
                          type="radio"
                          name="format"
                          className="mt-1"
                          checked={format === f}
                          onChange={() => setFormat(f)}
                        />
                        <span>
                          <b className="block text-[13px] font-medium">
                            {f === 'xlsx' ? 'Excel workbook (.xlsx)' : f === 'csv' ? 'Plain data (.csv)' : 'Document (.pdf)'}
                          </b>
                          <em className="not-italic text-tiny text-ink-3">{FORMAT_BLURB[f]}</em>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {needsRun && !data.hasAnalysis && (
                  <Note tone="bad">
                    This report is generated from analysis results. Run the analysis first.
                  </Note>
                )}

                <button
                  type="button"
                  className="pp-btn pp-btn-primary w-full py-2.5"
                  disabled={busy || (needsRun && !data.hasAnalysis)}
                  onClick={download}
                >
                  {busy ? 'Building\u2026' : `Download ${REPORT_KIND_LABEL[kind]}`}
                </button>
              </div>
            </Panel>
          </div>

          <div className="space-y-3.5">
            {data.hasAnalysis && c ? (
              <Panel title="What the report will contain">
                <dl className="pp-pad grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-[13px]">
                  <dt className="text-ink-3">Facility</dt>
                  <dd className="m-0">{data.facility}</dd>

                  <dt className="text-ink-3">Scope of this run</dt>
                  <dd className="m-0">
                    {data.run?.scopeKind === 'full' ? 'Full library for this facility' : data.run?.label}
                  </dd>

                  <dt className="text-ink-3">Requirements</dt>
                  <dd className="m-0">
                    {c.total} across {data.frameworks?.length ?? 0} frameworks
                  </dd>

                  <dt className="text-ink-3">Policies</dt>
                  <dd className="m-0">
                    {data.policyCounts?.regulatory ?? 0} regulatory &middot;{' '}
                    {data.policyCounts?.outOfScope ?? 0} out of regulatory scope
                  </dd>

                  <dt className="text-ink-3">Coverage</dt>
                  <dd className="m-0">
                    {c.covered} covered &middot; {c.partial} partial &middot; {c.not_addressed} not addressed
                    &middot; {c.no_policy} no policy
                  </dd>

                  {c.conflict > 0 && (
                    <>
                      <dt className="text-ink-3">Contradictions</dt>
                      <dd className="m-0">{c.conflict} flagged</dd>
                    </>
                  )}

                  <dt className="text-ink-3">Reviewed</dt>
                  <dd className="m-0">{c.reviewed} of {c.total} confirmed by a person</dd>

                  <dt className="text-ink-3">Analysis runs</dt>
                  <dd className="m-0">
                    {data.runCount}
                    {(data.runCount ?? 0) > 1 && ` \u00b7 ${data.firstPct}% \u2192 ${data.latestPct}%`}
                  </dd>
                </dl>

                <div className="pp-pad space-y-2.5 border-t border-line-2">
                  {!!data.unreviewed && (
                    <Note tone="bad">
                      {data.unreviewed} finding(s) are still unreviewed. Exports mark them as unconfirmed.
                    </Note>
                  )}
                  {!!data.needsRereview && (
                    <Note tone="bad">
                      {data.needsRereview} finding(s) were reviewed against wording or a policy match that has
                      since changed. Re-confirm before issuing this report.
                    </Note>
                  )}
                  <p className="m-0 text-tiny text-ink-3">{PRODUCT_DISCLAIMER}</p>
                </div>
              </Panel>
            ) : (
              <EmptyState
                title="No analysis yet"
                message="Coverage, mapping, gap and remediation reports are generated from analysis results. The audit trail and analysis history can still be exported."
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
