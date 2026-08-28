import type { ReactNode } from 'react';
import { COVERAGE_LABEL, COVERAGE_PILL, CoverageStatus, ReviewStatus } from '@policy-prism/shared';

/* ------------------------------------------------------------------ *
 * Layout primitives
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  sub,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`pp-panel ${className}`}>
      {(title || actions || sub) && (
        <header className="pp-panel-head">
          <div className="min-w-0">
            {title && <h3>{title}</h3>}
            {sub && <div className="pp-sub mt-0.5">{sub}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * "Nothing here" is a different message from "this failed" and from "still
 * loading". Each has its own component so a screen can never conflate them.
 */
export function EmptyState({
  title,
  message,
  action,
  tone = 'neutral',
}: {
  title: string;
  message: string;
  action?: ReactNode;
  /** 'good' for an empty state that is a positive result, e.g. no gaps found. */
  tone?: 'neutral' | 'good';
}) {
  return (
    <div className="pp-panel">
      <div className="pp-empty-state">
        <span
          aria-hidden
          className={`mb-1 flex h-9 w-9 items-center justify-center rounded-pill ${
            tone === 'good' ? 'bg-seal-bg text-seal' : 'bg-panel-2 text-ink-3'
          }`}
        >
          {tone === 'good' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M5.5 7h5M5.5 9.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <h4>{title}</h4>
        <p>{message}</p>
        {action && <div className="mt-3 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-line bg-panel px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4">
      <div className="min-w-0">
        <h1 className="text-[19px]">{title}</h1>
        {description && <p className="mt-0.5 text-xs2 text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Pills
 * ------------------------------------------------------------------ */

const COVERAGE_BADGE: Record<CoverageStatus, string> = {
  covered: 'cov',
  partial: 'par',
  not_addressed: 'gap',
  no_policy: 'none',
};

export function CoveragePill({ status }: { status: CoverageStatus }) {
  return (
    <span className={`pp-badge pp-badge-${COVERAGE_BADGE[status]}`} title={COVERAGE_LABEL[status]}>
      {COVERAGE_LABEL[status]}
    </span>
  );
}

const REVIEW_LABEL: Record<ReviewStatus, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Pending review',
};

export function ReviewPill({ status }: { status: ReviewStatus }) {
  const cls = status === 'approved' ? 'cov' : status === 'rejected' ? 'gap' : 'pend';
  return (
    <span className={`pp-badge pp-badge-${cls}`} title={REVIEW_LABEL[status]}>
      {REVIEW_LABEL[status]}
    </span>
  );
}

export function FrameworkPill({ framework }: { framework: string }) {
  return <span className="pp-fw">{framework}</span>;
}

export function PriorityPill({ priority }: { priority: 'Critical' | 'High' | 'Medium' }) {
  const cls = priority === 'Critical' ? 'gap' : priority === 'High' ? 'par' : 'none';
  return (
    <span className={`pp-badge pp-badge-${cls}`} title={`${priority} priority`}>
      {priority}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

/**
 * Skeletons stand in for content while it loads.
 *
 * The alternative - rendering the real layout with zeros - is worse than a
 * blank screen here: a compliance figure of 0% looks like an answer, and a
 * reader has no way to tell it apart from a facility with genuinely no
 * coverage.
 */
export function SkeletonStats({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pp-panel pp-pad">
          <div className="pp-skel-line mb-3 w-20" />
          <div className="pp-skel-stat mb-2" />
          <div className="pp-skel-line w-32" />
        </div>
      ))}
      <span className="sr-only">Loading figures</span>
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="pp-panel" aria-busy="true" aria-live="polite">
      <div className="border-b border-line-2 px-4 py-3">
        <div className="pp-skel-line w-40" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 border-b border-line-2 px-4 py-3 last:border-b-0">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="pp-skel-line"
              style={{ width: c === 1 ? '40%' : `${100 / (cols + 2)}%` }}
            />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading rows</span>
    </div>
  );
}

export function Loading({ label = 'Loading\u2026' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-10 text-ink-3">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ink" />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/**
 * Translates a failure into something a compliance officer can act on.
 *
 * Raw messages like "Request failed (503)" tell the reader nothing about what
 * to do, so the common causes get plain wording and the technical detail moves
 * to a disclosure for whoever needs it.
 */
function explainFailure(error: unknown): { headline: string; advice: string; detail: string } {
  const status = (error as { status?: number })?.status;
  const detail = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  if (status === 401 || status === 403) {
    return {
      headline: 'Your session has ended',
      advice: 'Sign in again to continue. Nothing you saved has been lost.',
      detail,
    };
  }
  if (status === 404) {
    return {
      headline: 'That is no longer here',
      advice: 'It may have been deleted, or it belongs to a different hospital profile.',
      detail,
    };
  }
  if (status === 0) {
    return {
      headline: 'Could not reach the server',
      advice: 'Check your connection and try again. The server may also be waking up.',
      detail,
    };
  }
  if (status && status >= 500) {
    return {
      headline: 'The server had a problem',
      advice: 'This is not something you did. Try again in a moment.',
      detail,
    };
  }
  return {
    headline: 'Could not load this view',
    advice: 'Try again. If it keeps happening, the detail below will help diagnose it.',
    detail,
  };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { headline, advice, detail } = explainFailure(error);
  return (
    <div className="pp-panel">
      <div className="pp-pad">
        <div className="pp-note pp-note-bad">
          <b>{headline}</b>
          <div className="mt-1">{advice}</div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRetry && (
            <button type="button" className="pp-btn pp-btn-sm" onClick={onRetry}>
              Try again
            </button>
          )}
          <details className="text-xs2 text-ink-3">
            <summary className="cursor-pointer select-none">Technical detail</summary>
            <code className="mt-1.5 block font-mono text-tiny">{detail}</code>
          </details>
        </div>
      </div>
    </div>
  );
}

export function Note({ tone = 'warn', children }: { tone?: 'warn' | 'bad'; children: ReactNode }) {
  return <div className={`pp-note ${tone === 'bad' ? 'pp-note-bad' : ''}`}>{children}</div>;
}

/* ------------------------------------------------------------------ *
 * Meters and stats
 * ------------------------------------------------------------------ */

export function CoverageMeter({
  covered,
  partial,
  gap,
  total,
}: {
  covered: number;
  partial: number;
  gap: number;
  total: number;
}) {
  const w = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div className="pp-meter" role="img" aria-label={`${covered} covered, ${partial} partial, ${gap} gaps`}>
      <i className="block h-full bg-seal transition-[width] duration-500" style={{ width: w(covered) }} />
      <i className="block h-full bg-[#C99114] transition-[width] duration-500" style={{ width: w(partial) }} />
      <i className="block h-full bg-flag transition-[width] duration-500" style={{ width: w(gap) }} />
    </div>
  );
}

export function Stat({
  label,
  value,
  detail,
  tone,
  children,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'seal' | 'gap';
  children?: ReactNode;
}) {
  const colour = tone === 'seal' ? 'text-seal' : tone === 'gap' ? 'text-flag' : '';
  // The hairline at the card's top edge carries the tone too, so the meaning
  // survives when the figure itself is neutral (a count of zero, say).
  const accent = tone === 'seal' ? 'pp-stat-good' : tone === 'gap' ? 'pp-stat-bad' : '';
  return (
    <div className={`pp-stat ${accent}`}>
      <div className="pp-stat-k">{label}</div>
      <div className={`pp-stat-v ${colour}`}>{value}</div>
      {detail && <div className="pp-stat-d">{detail}</div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drawer
 * ------------------------------------------------------------------ */

export function Drawer({
  open,
  onClose,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(14,28,38,.4)]" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,94vw)] flex-col bg-panel shadow-drawer"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-2 px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <div className="mb-1.5 flex flex-wrap gap-1.5">{eyebrow}</div>}
            <h2 className="text-[17px]">{title}</h2>
            {subtitle && <div className="mt-1 font-mono text-[12px] text-ink-3">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 text-[20px] leading-none text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 pb-10 pt-5">{children}</div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 'min(560px,100%)',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-[rgba(14,28,38,.4)]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        style={{ width }}
        className="relative flex max-h-[90vh] flex-col rounded-md bg-panel shadow-xl"
      >
        <header className="border-b border-line-2 px-6 py-4">
          <h3 className="text-[16px]">{title}</h3>
          {description && <p className="mt-1 text-xs2 text-ink-3">{description}</p>}
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-2 px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function Pager({
  page,
  perPage,
  total,
  onPage,
}: {
  page: number;
  perPage: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.ceil(total / perPage);
  if (pages < 2) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs2 text-ink-3">
      page {page + 1}/{pages}
      <button type="button" className="pp-btn pp-btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
        Prev
      </button>
      <button
        type="button"
        className="pp-btn pp-btn-sm"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </span>
  );
}

export const formatPct = (score: number): string => `${(score * 100).toFixed(0)}%`;

export const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** Highlights matched terms inside a requirement or policy quote. */
export function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!escaped.length) return <>{text}</>;
  const re = new RegExp(`\\b(${escaped.join('|')})\\w*`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) && i % 2 === 1 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  );
}
