import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getBranchId, setBranchId } from '@/api/client';
import { Modal } from '@/components/ui';

export interface BranchSummary {
  id: number;
  name: string;
  branchLabel: string;
  isPrimary: boolean;
  state: string;
  beds: number;
  facilityType: string;
  licenseType: string;
  medicare: boolean;
  accredited: boolean;
  services: string[];
  policyCount: number;
  regulationCount: number;
  runCount: number;
}

/**
 * Switches the branch every request operates on. Each branch owns its policies,
 * requirements and analysis history, so switching swaps the entire working set.
 */
export default function BranchSwitcher() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => await api.get<BranchSummary[]>('/api/branches'),
  });

  const branches = data?.data ?? [];
  const meta = data?.meta as
    | { organizationName?: string | null; activeBranchId?: number; homeBranchId?: number }
    | undefined;

  const activeId = getBranchId() ?? meta?.activeBranchId ?? meta?.homeBranchId ?? null;
  const active = branches.find((b) => b.id === activeId) ?? branches[0];

  /**
   * Switching profile changes every piece of data on screen. Rather than trying
   * to invalidate each cached query - the branch is a request header, not part
   * of the query key, so stale entries can survive - reload in place. Staying
   * on the current page means switching does not lose the user's context.
   */
  const switchTo = (id: number) => {
    setBranchId(id);
    // Record the switch before reloading, so the audit trail shows who moved
    // into this profile and when. Fire-and-forget: a failed log must never
    // block the switch itself.
    void api
      .post(`/api/branches/${id}/viewed`)
      .catch(() => undefined)
      .finally(() => {
        queryClient.clear();
        window.location.reload();
      });
  };

  if (!branches.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded border border-sidebar-line px-2.5 py-2 text-left text-[13px] text-[#DCE7EB] hover:bg-sidebar-hover"
        title="Switch branch"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{active?.branchLabel ?? active?.name}</span>
          <span className="block text-[11px] text-[#7E949D]">
            {branches.length > 1 ? `${branches.length} branches` : meta?.organizationName ?? 'Single branch'}
          </span>
        </span>
        <span className="text-[10px] text-[#5F7783]">▾</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Branches"
        description="Each hospital profile keeps its own policies, requirements and analysis history. Switching changes everything you see. Add one under Facility profile."
        width="min(680px,100%)"
        footer={
          <button type="button" className="pp-btn" onClick={() => setOpen(false)}>
            Close
          </button>
        }
      >
        <div className="space-y-2">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => switchTo(b.id)}
              className={`flex w-full items-start gap-3 rounded border px-3.5 py-3 text-left ${
                b.id === activeId ? 'border-seal bg-seal-bg' : 'border-line hover:bg-panel-2'
              }`}
            >
              <span className="min-w-0 flex-1">
                <b className="block text-[14px] font-medium">
                  {b.branchLabel}
                  {b.isPrimary && <span className="pp-pill pp-pill-fw ml-2">default</span>}
                  {b.id === activeId && <span className="pp-pill pp-pill-cov ml-2">viewing</span>}
                </b>
                <span className="mt-0.5 block text-xs2 text-ink-3">
                  {b.name} &middot; {b.beds} beds &middot; {b.facilityType} &middot; {b.state}
                </span>
                <span className="mt-1 block text-tiny text-ink-3">
                  {b.policyCount} policies &middot; {b.regulationCount} requirements &middot;{' '}
                  {b.runCount} analysis run{b.runCount === 1 ? '' : 's'}
                  {b.services.length ? ` \u00b7 ${b.services.join(', ')}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </Modal>

    </>
  );
}
