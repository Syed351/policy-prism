import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthUser, ROLES, ROLE_KEYS, RoleKey } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import { Modal, Panel } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';

/**
 * Who can do what. Roles are the product's permission model: an auditor reads
 * and exports, a reviewer decides, an analyst edits, a manager does all of it.
 * Only administrators see this panel.
 */
/** The permissions a role grants, as readable names. */
function grants(role: RoleKey): string[] {
  return Object.entries(ROLES[role].can)
    .filter(([, allowed]) => allowed)
    .map(([name]) => name);
}

export default function TeamPanel() {
  const { user, can } = useAuth();
  const { toast, errorToast } = useToast();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);

  const isAdmin = user?.role === 'admin';

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: async () => (await api.get<AuthUser[]>('/api/auth/users')).data,
    enabled: isAdmin,
  });

  const [draft, setDraft] = useState({
    name: '',
    email: '',
    password: '',
    role: 'viewer' as RoleKey,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Record<string, unknown> }) =>
      (await api.patch<AuthUser>(`/api/auth/users/${id}`, patch)).data,
    onSuccess: async () => {
      toast('Team member updated.');
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Could not update'),
  });

  const invite = useMutation({
    mutationFn: async () => (await api.post<AuthUser>('/api/auth/register', draft)).data,
    onSuccess: async (u) => {
      toast(`${u.name} added as ${ROLES[u.role].label}.`);
      setInviting(false);
      setDraft({ name: '', email: '', password: '', role: 'viewer' });
      await queryClient.invalidateQueries({ queryKey: ['team'] });
    },
    onError: (err) =>
      errorToast(err instanceof ApiClientError ? err.message : 'Could not add the user'),
  });

  if (!isAdmin) return null;

  const members = data ?? [];

  return (
    <>
      <Panel
        title="Team and roles"
        sub="Roles decide what each person can do. Everyone here can work in any of your hospital profiles."
        actions={
          can('edit') && (
            <button type="button" className="pp-btn pp-btn-primary" onClick={() => setInviting(true)}>
              Add team member
            </button>
          )
        }
      >
        {isLoading && <div className="pp-pad text-xs2 text-ink-3">Loading&hellip;</div>}

        <div className="overflow-x-auto">
          <table className="pp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="w-[240px]">Email</th>
                <th className="w-[190px]">Role</th>
                <th className="w-[120px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <b className="font-medium">{m.name}</b>
                    {m.id === user?.id && <span className="pp-pill pp-pill-fw ml-2">you</span>}
                  </td>
                  <td className="font-mono text-tiny text-ink-3">{m.email}</td>
                  <td>
                    <select
                      className="pp-select"
                      value={m.role}
                      disabled={update.isPending}
                      onChange={(e) =>
                        update.mutate({ id: m.id, patch: { role: e.target.value as RoleKey } })
                      }
                    >
                      {ROLE_KEYS.map((r) => (
                        <option key={r} value={r}>
                          {ROLES[r].label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-tiny text-ink-3">
                      {grants(m.role).join(', ') || 'read only'}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="pp-btn pp-btn-sm"
                      disabled={update.isPending || m.id === user?.id}
                      title={
                        m.id === user?.id
                          ? 'You cannot suspend your own account'
                          : m.isActive
                            ? 'Suspend this account'
                            : 'Restore access'
                      }
                      onClick={() =>
                        update.mutate({ id: m.id, patch: { isActive: !m.isActive } })
                      }
                    >
                      {m.isActive ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {!members.length && !isLoading && (
                <tr>
                  <td colSpan={4} className="pp-empty">
                    No other team members yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pp-pad border-t border-line-2">
          <div className="pp-label mb-2">What each role can do</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_KEYS.map((r) => (
              <div key={r} className="text-xs2">
                <b className="font-medium text-ink">{ROLES[r].label}</b>
                <div className="text-ink-3">{grants(r).join(', ') || 'read and export only'}</div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Modal
        open={inviting}
        onClose={() => setInviting(false)}
        title="Add a team member"
        description="They sign in with this email and password, and can change the password afterwards."
        footer={
          <>
            <button type="button" className="pp-btn" onClick={() => setInviting(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              disabled={
                invite.isPending ||
                draft.name.trim().length < 2 ||
                !draft.email.includes('@') ||
                draft.password.length < 10
              }
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? 'Adding\u2026' : 'Add member'}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <div className="pp-field">
            <label htmlFor="tm-name">Name</label>
            <input
              id="tm-name"
              className="pp-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="pp-field">
            <label htmlFor="tm-email">Email</label>
            <input
              id="tm-email"
              type="email"
              className="pp-input"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>
          <div className="pp-field">
            <label htmlFor="tm-pass">Temporary password</label>
            <input
              id="tm-pass"
              className="pp-input"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
            <p className="mt-1 text-tiny text-ink-3">
              At least 10 characters. Share it with them directly &mdash; they can change it from the
              sign-in page.
            </p>
          </div>
          <div className="pp-field">
            <label htmlFor="tm-role">Role</label>
            <select
              id="tm-role"
              className="pp-select"
              value={draft.role}
              onChange={(e) => setDraft({ ...draft, role: e.target.value as RoleKey })}
            >
              {ROLE_KEYS.map((r) => (
                <option key={r} value={r}>
                  {ROLES[r].label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[12px] text-ink-3">
              {grants(draft.role).length
                ? `Can ${grants(draft.role).join(', ')}.`
                : 'Can read and export, but change nothing.'}
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
