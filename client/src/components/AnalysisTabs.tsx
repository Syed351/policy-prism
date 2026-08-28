import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DashboardDto } from '@policy-prism/shared';
import { api } from '@/api/client';

/**
 * The analysis views are one workflow, not six unrelated pages, so they share a
 * tab strip with live counts - the way the prototype presented them.
 */
export default function AnalysisTabs() {
  const { data } = useQuery({
    queryKey: ['dashboard', ''],
    queryFn: async () => (await api.get<DashboardDto>('/api/dashboard')).data,
  });

  const c = data?.counts;
  const tabs: Array<[string, string, number | undefined]> = [
    ['/dashboard', 'Coverage', undefined],
    ['/mapping', 'Mapping', c?.total || undefined],
    ['/policy-check', 'Policy check', undefined],
    ['/gaps', 'Gaps', c?.gap || undefined],
    ['/review', 'Review queue', c?.pending || undefined],
    ['/reports', 'Reports', undefined],
  ];

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-line bg-panel px-4 sm:px-6">
      {tabs.map(([to, label, badge]) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] transition-colors ${
              isActive
                ? 'border-ink font-medium text-ink'
                : 'border-transparent text-ink-3 hover:text-ink-2'
            }`
          }
        >
          {label}
          {badge ? (
            <span className="rounded-full bg-[#EEF1F2] px-1.5 font-mono text-[10.5px] text-ink-2">
              {badge}
            </span>
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}
