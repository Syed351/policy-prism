import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FACILITY_TYPES, SERVICES, STATES } from '@policy-prism/shared';
import { api, ApiClientError, getBranchId, setBranchId } from '@/api/client';
import type { BranchSummary } from '@/components/BranchSwitcher';
import { Modal, Panel } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

/**
 * Every hospital profile owns its data outright: its own policies, requirement
 * library, analysis runs, findings and audit trail. Nothing is shared, so a
 * second profile starts empty unless you copy a requirement library into it.
 */
export default function HospitalProfilesPanel() {
  const { can } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const { data } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => await api.get<BranchSummary[]>('/api/branches'),
  });

  const profiles = data?.data ?? [];
  const meta = data?.meta as { activeBranchId?: number; homeBranchId?: number } | undefined;
  const activeId = getBranchId() ?? meta?.activeBranchId ?? meta?.homeBranchId ?? null;

  const [draft, setDraft] = useState({
    name: '',
    branchLabel: '',
    beds: 0,
    state: 'OH',
    facilityType: FACILITY_TYPES[0] as (typeof FACILITY_TYPES)[number],
    licenseType: 'General acute care license',
    medicare: true,
    accredited: true,
    services: {} as Record<string, boolean>,
    copyRegulationsFrom: null as number | null,
  });

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

  const [confirmDelete, setConfirmDelete] = useState<BranchSummary | null>(null);

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.del(`/api/branches/${id}`)).data,
    onSuccess: async (result) => {
      setConfirmDelete(null);
      const deletedActive = (result as { id?: number })?.id === activeId;
      if (deletedActive) {
        // The profile being viewed is gone; fall back to the home profile and
        // reload in place rather than jumping the user somewhere else.
        setBranchId(null);
        queryClient.clear();
        window.location.reload();
        return;
      }
      toast('Hospital profile deleted.');
      await queryClient.resetQueries();
    },
    onError: (err) =>
      errorToast(err instanceof ApiClientError ? err.message : 'Could not delete the profile'),
  });

  const create = useMutation({
    mutationFn: async () => (await api.post<BranchSummary>('/api/branches', draft)).data,
    onSuccess: async (b) => {
      await queryClient.invalidateQueries();
      setCreating(false);
      toast(`${b.branchLabel} created. Now viewing it.`);
      switchTo(b.id);
    },
    onError: (err) =>
      errorToast(err instanceof ApiClientError ? err.message : 'Could not create the profile'),
  });

  return (
    <>
      <Panel
        title="Hospital profiles"
        sub={
          profiles.length > 1
            ? `${profiles.length} profiles \u2014 each with its own policies, requirements and analysis`
            : 'Add another profile if this organisation runs more than one facility'
        }
        actions={
          can('profile') && (
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setCreating(true)}>
              Add hospital profile
            </button>
          )
        }
      >
        {profiles.map((p) => (
          <div
            key={p.id}
            className={`flex flex-wrap items-start gap-3 border-b border-line-2 px-4 py-3 last:border-b-0 ${
              p.id === activeId ? 'bg-seal-bg' : ''
            }`}
          >
            <div className="min-w-0 flex-1">
              <b className="font-medium">
                {p.branchLabel}
                {p.isPrimary && <span className="pp-pill pp-pill-fw ml-2">default</span>}
                {p.id === activeId && <span className="pp-pill pp-pill-cov ml-2">viewing</span>}
              </b>
              <div className="mt-0.5 text-xs2 text-ink-3">
                {p.name} &middot; {p.beds} beds &middot; {p.facilityType} &middot; {p.state}
                {p.medicare ? ' \u00b7 Medicare' : ''}
                {p.accredited ? ' \u00b7 Accredited' : ''}
              </div>
              <div className="mt-1 text-tiny text-ink-3">
                {p.policyCount} policies &middot; {p.regulationCount} requirements &middot; {p.runCount}{' '}
                analysis run{p.runCount === 1 ? '' : 's'}
                {p.services.length ? ` \u00b7 ${p.services.join(', ')}` : ' \u00b7 no services set'}
              </div>
            </div>
            <span className="flex gap-1.5">
              {p.id !== activeId && (
                <button type="button" className="pp-btn pp-btn-sm" onClick={() => switchTo(p.id)}>
                  Switch to this
                </button>
              )}
              {can('profile') && profiles.length > 1 && p.id !== meta?.homeBranchId && (
                <button
                  type="button"
                  className="pp-btn pp-btn-sm"
                  title="Delete this profile and all of its data"
                  onClick={() => setConfirmDelete(p)}
                >
                  Delete
                </button>
              )}
            </span>
          </div>
        ))}
      </Panel>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this hospital profile?"
        description={confirmDelete ? confirmDelete.name : ''}
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
              {remove.isPending ? 'Deleting\u2026' : 'Delete permanently'}
            </button>
          </>
        }
      >
        {confirmDelete && (
          <>
            <div className="pp-note pp-note-bad">
              This removes {confirmDelete.policyCount} policies, {confirmDelete.regulationCount}{' '}
              requirements and {confirmDelete.runCount} analysis run
              {confirmDelete.runCount === 1 ? '' : 's'}, along with every finding, review decision and
              report for this profile. It cannot be undone.
            </div>
            <p className="mt-3 text-[13px] text-ink-2">
              The other profiles are untouched. If you only want to stop using this one, switch to
              another profile instead of deleting it.
            </p>
          </>
        )}
      </Modal>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="Add hospital profile"
        description="This profile gets its own policies, requirement library, analysis runs, reports and audit trail. Nothing is shared with the others."
        width="min(640px,100%)"
        footer={
          <>
            <button type="button" className="pp-btn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              disabled={create.isPending || draft.name.trim().length < 2}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating\u2026' : 'Create profile'}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="pp-field">
            <label htmlFor="hp-name">Facility name</label>
            <input
              id="hp-name"
              className="pp-input"
              placeholder="Riverbend North Campus"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div className="pp-field">
            <label htmlFor="hp-label">Short label</label>
            <input
              id="hp-label"
              className="pp-input"
              placeholder="North campus"
              value={draft.branchLabel}
              onChange={(e) => setDraft({ ...draft, branchLabel: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="pp-field">
              <label htmlFor="hp-beds">Licensed beds</label>
              <input
                id="hp-beds"
                type="number"
                min={0}
                className="pp-input"
                value={draft.beds}
                onChange={(e) => setDraft({ ...draft, beds: Number(e.target.value) })}
              />
            </div>
            <div className="pp-field">
              <label htmlFor="hp-state">State</label>
              <select
                id="hp-state"
                className="pp-select"
                value={draft.state}
                onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              >
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="pp-field">
              <label htmlFor="hp-type">Facility type</label>
              <select
                id="hp-type"
                className="pp-select"
                value={draft.facilityType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    facilityType: e.target.value as (typeof FACILITY_TYPES)[number],
                  })
                }
              >
                {FACILITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pp-label pt-1">Certification</div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['medicare', 'Medicare certified'],
                ['accredited', 'Accredited'],
              ] as Array<['medicare' | 'accredited', string]>
            ).map(([key, label]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-[13px] ${
                  draft[key] ? 'border-seal bg-seal-bg' : 'border-line'
                }`}
              >
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={() => setDraft({ ...draft, [key]: !draft[key] })}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="pp-label pt-1">Services at this facility</div>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((s) => (
              <label
                key={s.key}
                title={s.description}
                className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-[13px] ${
                  draft.services[s.key] ? 'border-seal bg-seal-bg' : 'border-line'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!draft.services[s.key]}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      services: { ...draft.services, [s.key]: !draft.services[s.key] },
                    })
                  }
                />
                {s.name}
              </label>
            ))}
          </div>

          <div className="pp-field pt-1">
            <label htmlFor="hp-copy">Requirement library</label>
            <select
              id="hp-copy"
              className="pp-select"
              value={draft.copyRegulationsFrom ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  copyRegulationsFrom: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">Start empty</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  Copy from {p.branchLabel} ({p.regulationCount} requirements)
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-ink-3">
              Facilities in one organisation usually answer to the same frameworks. Copying gives this
              profile an independent copy &mdash; editing one never affects the other. Which requirements
              actually apply still depends on the services and certification set above.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
