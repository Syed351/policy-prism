import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ANALYSIS_STEPS, DashboardDto, HospitalProfile } from '@policy-prism/shared';
import { api, ApiClientError } from '@/api/client';
import { initials, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import AnalysisTabs from '@/components/AnalysisTabs';
import BranchSwitcher from '@/components/BranchSwitcher';
import RunAnalysisModal from '@/components/RunAnalysisModal';

/** Routes that live under the Analysis tab group. */
const ANALYSIS_PATHS = ['/dashboard', '/mapping', '/policy-check', '/gaps', '/review', '/reports'];

interface NavItem {
  to: string;
  label: string;
  badge?: number;
}

function Prism({ className = 'h-[17px] w-[17px]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2 22 20H2L12 2Z" stroke="#4FBF9A" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 2v18" stroke="#4FBF9A" strokeWidth="1.2" opacity=".65" />
    </svg>
  );
}

export default function AppShell() {
  const { user, loading, signOut, can } = useAuth();
  const { toast, errorToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // A dropdown must be dismissible without taking an action inside it.
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const [runStep, setRunStep] = useState<string | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Auth restore is asynchronous. Firing data queries before it settles sends
  // unauthenticated requests that 401 and get cached as failures - which is
  // what made a hard refresh show "Sign in to continue" on a valid session.
  const authReady = !loading && !!user;

  const { data: profile } = useQuery({
    enabled: authReady,
    queryKey: ['profile'],
    queryFn: async () => (await api.get<{ profile: HospitalProfile }>('/api/hospital/profile')).data.profile,
  });

  const { data: dashboard } = useQuery({
    enabled: authReady,
    queryKey: ['dashboard', ''],
    queryFn: async () => (await api.get<DashboardDto>('/api/dashboard')).data,
  });

  /**
   * Running the analysis is a real backend call. The stepper is cosmetic
   * pacing over a request that genuinely does the work server-side.
   */
  const runAnalysis = useMutation({
    mutationFn: async () => {
      try {
        sessionStorage.setItem('pp_run_origin', location.pathname);
      } catch {
        /* storage unavailable - the back link just will not appear */
      }
      let i = 0;
      const timer = setInterval(() => {
        setRunStep(ANALYSIS_STEPS[Math.min(i++, ANALYSIS_STEPS.length - 1)]);
      }, 220);
      try {
        return (await api.post<{ run: { id: number; coveragePct: number; covered: number; partial: number; notAddressed: number; noPolicy: number; durationMs: number } }>(
          '/api/analysis/run',
          { trigger: 'Manual run' },
        )).data;
      } finally {
        clearInterval(timer);
        setRunStep(null);
      }
    },
    onSuccess: async (data) => {
      const r = data.run;
      const gaps = r.notAddressed + r.noPolicy;
      toast(`${r.covered} covered \u00b7 ${r.partial} partial \u00b7 ${gaps} gaps in ${r.durationMs} ms`);
      await queryClient.invalidateQueries();
      // Remember the page the run was started from so Coverage can link back.
      navigate('/dashboard', { state: { from: location.pathname } });
    },
    onError: (err) => errorToast(err instanceof ApiClientError ? err.message : 'Analysis failed'),
  });

  const counts = dashboard?.counts;
  const groups: Array<[string, NavItem[]]> = [
    ['Setup', [{ to: '/facility', label: 'Facility profile' }]],
    [
      'Library',
      [
        { to: '/policies', label: 'Policies', badge: dashboard?.policyCount },
        { to: '/regulations', label: 'Regulations', badge: dashboard?.inScopeCount },
      ],
    ],
    [
      'Analysis',
      // One entry only. The individual views are tabs on the Analysis page, so
      // the sidebar stays a short list of places rather than a duplicate of it.
      [{ to: '/dashboard', label: 'Analysis', badge: counts?.pending || undefined }],
    ],
    ['Records', [{ to: '/audit', label: 'Audit trail' }]],
  ];

  /** The Analysis entry represents its whole tab group, not just /dashboard. */
  const navActive = (to: string, exact: boolean): boolean =>
    to === '/dashboard' ? ANALYSIS_PATHS.includes(location.pathname) : exact;

  return (
    <div className="grid min-h-screen lg:grid-cols-[224px_1fr]">
      {/* ---- mobile top bar: the sidebar is off-canvas below lg ---- */}
      <div className="flex items-center gap-3 border-b border-sidebar-line bg-sidebar px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Open navigation"
          className="rounded border border-sidebar-line px-2.5 py-1.5 text-[#DCE7EB] hover:bg-sidebar-hover"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <Prism />
        <b className="text-[15px] font-semibold tracking-[-0.01em] text-white">Policy Prism</b>
      </div>

      {/* Backdrop, mobile only, dismisses the drawer. */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(14,28,38,.5)] lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      {/* ---- sidebar ---- */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col bg-sidebar text-sidebar-text transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:translate-x-0 ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between gap-2.5 border-b border-sidebar-line px-4 py-3.5">
          <span className="flex items-center gap-2.5">
            <Prism />
            <b className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-white">
              Policy Prism
            </b>
          </span>
          <button
            type="button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
            className="rounded px-2 text-[18px] leading-none text-[#7E949D] hover:text-white lg:hidden"
          >
            &times;
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-3">
          {groups.map(([groupLabel, items]) => (
            <div key={groupLabel} className="block">
              <div className="px-2.5 pb-2 pt-4 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#5F7783] first:pt-1">
                {groupLabel}
              </div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setNavOpen(false)}
                  className={({ isActive: exact }) =>
                    `flex w-auto shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded px-2.5 py-2 text-[13.5px] transition-colors lg:w-full ${
                      navActive(item.to, exact)
                        ? 'bg-sidebar-on font-medium text-white'
                        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-[#DCE7EB]'
                    }`
                  }
                >
                  {({ isActive: exact }) => (
                    <>
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span
                          className={`rounded-full px-1.5 font-mono text-[10.5px] ${
                            navActive(item.to, exact)
                              ? 'bg-flag text-white'
                              : 'bg-[#33474F] text-[#CFE0E6]'
                          }`}
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-line px-3 pb-3.5 pt-3">
          <div className="mb-2.5">
            <BranchSwitcher />
          </div>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              className="flex w-full items-center gap-2.5 rounded border border-sidebar-line px-2.5 py-2 text-left text-[13px] text-[#DCE7EB] hover:bg-sidebar-hover"
            >
              <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-seal text-[10.5px] font-semibold text-white">
                {initials(user?.name ?? '')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{user?.name}</span>
                <span className="block text-[11px] text-[#7E949D]">{user?.roleLabel}</span>
              </span>
              <span className="text-[10px] text-[#5F7783]">▾</span>
            </button>

            <button
              type="button"
              className="mt-1.5 w-full rounded border border-sidebar-line px-2.5 py-1.5 text-[12.5px] text-[#9FB4BD] hover:bg-sidebar-hover hover:text-[#DCE7EB]"
              onClick={async () => {
                setMenuOpen(false);
                await signOut();
                navigate('/login');
              }}
            >
              Sign out
            </button>

            {menuOpen && (
              <div className="absolute bottom-[46px] left-0 right-0 z-30 rounded-md border border-line bg-panel p-3 shadow-xl">
                <b className="mb-2 block font-medium text-ink">{user?.name}</b>
                <div className="mb-3 text-xs2 text-ink-3">{user?.email}</div>
                <div className="mb-3 text-tiny text-ink-3">
                  Permissions:{' '}
                  {Object.entries(user?.permissions ?? {})
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                    .join(', ') || 'read only'}
                </div>
                <button
                  type="button"
                  className="pp-btn pp-btn-sm w-full"
                  onClick={() => setMenuOpen(false)}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ---- main ---- */}
      <main className="flex min-w-0 flex-col">
        {runAnalysis.isPending && (
          <div className="border-b border-line bg-panel">
            <div className="h-[3px] overflow-hidden bg-line-2">
              <div className="h-full animate-pulse bg-auto" style={{ width: '70%' }} />
            </div>
            <div className="flex flex-wrap items-baseline gap-3.5 px-6 py-2 text-[12px] text-ink-2">
              <span>{runStep ?? 'Starting analysis\u2026'}</span>
              <span className="text-tiny text-ink-3">
                {`${dashboard?.inScopeCount ?? 0} requirements \u00b7 ${dashboard?.policyCount ?? 0} policies`}
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-6">
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="pp-btn"
              disabled={!can('run') || runAnalysis.isPending}
              title="Choose which policies or frameworks this run covers"
              onClick={() => setScopeOpen(true)}
            >
              Scope&hellip;
            </button>
            <button
              type="button"
              className="pp-btn pp-btn-primary"
              disabled={!can('run') || runAnalysis.isPending}
              title={can('run') ? 'Compare every applicable requirement against your policy set' : `Your role (${user?.roleLabel}) cannot run the analysis.`}
              onClick={() => runAnalysis.mutate()}
            >
              {runAnalysis.isPending ? 'Analyzing\u2026' : 'Run analysis'}
            </button>
          </span>
        </div>

        {ANALYSIS_PATHS.includes(location.pathname) && <AnalysisTabs />}

        <Outlet />

        <RunAnalysisModal open={scopeOpen} onClose={() => setScopeOpen(false)} />
      </main>
    </div>
  );
}
