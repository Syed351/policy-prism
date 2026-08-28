import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FACILITY_TYPES,
  HospitalProfile,
  SERVICES,
  ServiceKey,
  STATES,
} from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import HospitalProfilesPanel from '@/components/HospitalProfilesPanel';
import TeamPanel from '@/components/TeamPanel';
import { ErrorState, FrameworkPill, Loading, Note, PageHeader, Panel } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

interface ProfileResponse {
  profile: HospitalProfile;
  scope: { inScopeCount: number; libraryCount: number; frameworks: string[]; hasStateLibrary: boolean };
  options: { states: readonly string[]; facilityTypes: readonly string[]; services: typeof SERVICES };
}

export default function FacilityPage() {
  const { can, user } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HospitalProfile | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['profile', 'full'],
    queryFn: async () => (await api.get<ProfileResponse>('/api/hospital/profile')).data,
  });

  useEffect(() => {
    if (data && !draft) setDraft(data.profile);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async (payload: Partial<HospitalProfile>) =>
      (
        await api.patch<{ profile: HospitalProfile; changes: string[]; scope: { before: number; after: number }; note: string | null }>(
          '/api/hospital/profile',
          payload,
        )
      ).data,
    onSuccess: (result) => {
      setEditing(false);
      setDraft(result.profile);
      queryClient.invalidateQueries();
      toast(
        result.changes.length
          ? `Profile saved \u00b7 ${result.changes.join(' \u00b7 ')}`
          : 'Profile saved (no effective change)',
      );
      if (result.note) setTimeout(() => toast(result.note!), 900);
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not save the profile'),
  });

  if (isLoading || !draft) return <Loading label="Loading facility profile\u2026" />;
  if (error) return <div className="p-6"><ErrorState error={error} onRetry={refetch} /></div>;
  if (!data) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.profile);
  const readOnly = !editing || !can('profile');
  const noStateLibrary = !data.scope.hasStateLibrary;

  const set = <K extends keyof HospitalProfile>(key: K, value: HospitalProfile[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const toggleService = (key: ServiceKey) =>
    setDraft((d) => (d ? { ...d, services: { ...d.services, [key]: !d.services[key] } } : d));

  return (
    <>
      <PageHeader
        title="Facility profile"
        description="Tells the system which regulations apply to you"
        actions={
          can('profile') ? (
            editing ? (
              <>
                <button
                  type="button"
                  className="pp-btn"
                  onClick={() => {
                    setDraft(data.profile);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pp-btn pp-btn-primary"
                  disabled={!dirty || save.isPending}
                  onClick={() =>
                    save.mutate({
                      name: draft.name,
                      beds: draft.beds,
                      state: draft.state,
                      facilityType: draft.facilityType,
                      licenseType: draft.licenseType,
                      medicare: draft.medicare,
                      accredited: draft.accredited,
                      services: draft.services,
                    })
                  }
                >
                  {save.isPending ? 'Saving\u2026' : 'Save profile'}
                </button>
              </>
            ) : (
              <button type="button" className="pp-btn pp-btn-primary" onClick={() => setEditing(true)}>
                Edit profile
              </button>
            )
          ) : (
            <span className="text-xs2 text-ink-3">Your role ({user?.roleLabel}) cannot edit the profile</span>
          )
        }
      />

      <div className="flex-1 space-y-3.5 px-4 py-4 sm:px-6 sm:py-5">
        <HospitalProfilesPanel />

        <TeamPanel />

        <div className="grid gap-3.5 lg:grid-cols-[1.25fr_1fr]">
          <Panel
            title="Facility details"
            sub={editing ? 'Editing \u2014 nothing applies until you save' : undefined}
          >
            <div className="pp-pad space-y-3.5">
              <div className="pp-field">
                <label htmlFor="fac-name">Facility name</label>
                <input
                  id="fac-name"
                  className="pp-input"
                  value={draft.name}
                  disabled={readOnly}
                  onChange={(e) => set('name', e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="pp-field">
                  <label htmlFor="fac-beds">Licensed beds</label>
                  <input
                    id="fac-beds"
                    type="number"
                    min={0}
                    className="pp-input"
                    value={draft.beds}
                    disabled={readOnly}
                    onChange={(e) => set('beds', Number(e.target.value))}
                  />
                </div>
                <div className="pp-field">
                  <label htmlFor="fac-state">State</label>
                  <select
                    id="fac-state"
                    className="pp-select"
                    value={draft.state}
                    disabled={readOnly}
                    onChange={(e) => set('state', e.target.value)}
                  >
                    {STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="pp-field">
                  <label htmlFor="fac-type">Facility type</label>
                  <select
                    id="fac-type"
                    className="pp-select"
                    value={draft.facilityType}
                    disabled={readOnly}
                    onChange={(e) => set('facilityType', e.target.value)}
                  >
                    {FACILITY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pp-field">
                <label htmlFor="fac-license">License type</label>
                <input
                  id="fac-license"
                  className="pp-input"
                  value={draft.licenseType}
                  disabled={readOnly}
                  onChange={(e) => set('licenseType', e.target.value)}
                />
              </div>

              <div className="pp-label pt-1">Certification and accreditation</div>
              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
                  draft.medicare ? 'border-seal bg-seal-bg' : 'border-line'
                } ${readOnly ? 'cursor-default opacity-90' : ''}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.medicare}
                  disabled={readOnly}
                  onChange={() => set('medicare', !draft.medicare)}
                />
                <span>
                  <b className="block text-[13px] font-medium">Medicare certified</b>
                  <em className="not-italic text-tiny text-ink-3">
                    Brings the CMS Conditions of Participation into scope
                  </em>
                </span>
              </label>

              <label
                className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
                  draft.accredited ? 'border-seal bg-seal-bg' : 'border-line'
                } ${readOnly ? 'cursor-default opacity-90' : ''}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.accredited}
                  disabled={readOnly}
                  onChange={() => set('accredited', !draft.accredited)}
                />
                <span>
                  <b className="block text-[13px] font-medium">Accredited</b>
                  <em className="not-italic text-tiny text-ink-3">
                    Brings The Joint Commission standards into scope
                  </em>
                </span>
              </label>

              <div className="pp-label pt-1">Services offered</div>
              {SERVICES.map((s) => (
                <label
                  key={s.key}
                  className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2.5 ${
                    draft.services[s.key] ? 'border-seal bg-seal-bg' : 'border-line'
                  } ${readOnly ? 'cursor-default opacity-90' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!draft.services[s.key]}
                    disabled={readOnly}
                    onChange={() => toggleService(s.key)}
                  />
                  <span>
                    <b className="block text-[13px] font-medium">{s.name}</b>
                    <em className="not-italic text-tiny text-ink-3">{s.description}</em>
                  </span>
                </label>
              ))}
            </div>
          </Panel>

          <div className="space-y-3.5">
            <Panel title="What this profile brings into scope">
              <div className="pp-pad">
                <div className="font-serif text-[34px] font-medium leading-none">{data.scope.inScopeCount}</div>
                <div className="mt-1 text-xs2 text-ink-3">
                  of {data.scope.libraryCount} requirements in the library apply to this facility
                </div>

                <div className="pp-label mt-5 mb-2">Frameworks in scope</div>
                <div className="flex flex-wrap gap-1.5">
                  {data.scope.frameworks.map((f) => (
                    <FrameworkPill key={f} framework={f} />
                  ))}
                </div>

                {noStateLibrary && (
                  <div className="mt-4">
                    <Note>
                      No state requirements are loaded for {data.profile.state}. Add them under Regulations, or
                      upload a state library, so licensure obligations are assessed too.
                    </Note>
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="How scope works">
              <div className="pp-pad space-y-2.5 text-xs2 text-ink-2">
                <p>
                  Each requirement carries an applicability rule. <b>All facilities</b> always applies;{' '}
                  <b>Medicare certified</b> and <b>Accredited</b> follow the flags above; service rules follow
                  the checkboxes; and state rules match only the state you select.
                </p>
                <p>
                  Changing any of these changes the requirement set, so coverage percentages before and after a
                  change are not comparable. The dashboard marks that break in the run history rather than
                  quietly plotting them on the same line.
                </p>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
