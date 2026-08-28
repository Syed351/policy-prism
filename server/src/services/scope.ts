/**
 * Applicability. The facility profile decides which requirements are in scope,
 * exactly as the prototype's `applies()` did.
 */

import { SERVICES, ServiceKey } from '@policy-prism/shared';

export interface ScopeProfile {
  state: string;
  medicare: boolean;
  accredited: boolean;
  facilityType: string;
  services: Record<ServiceKey, boolean>;
}

export interface ScopeRegulation {
  applicability: string | null;
  effectiveDate?: string | null;
}

/** Does this requirement apply to this facility? */
export function applies(reg: ScopeRegulation, profile: ScopeProfile): boolean {
  const a = reg.applicability || 'always';
  if (a === 'always') return true;
  if (a === 'medicare') return !!profile.medicare;
  if (a === 'accredited') return !!profile.accredited;
  if (a.startsWith('state:')) return a.slice(6) === profile.state;
  return !!profile.services[a as ServiceKey];
}

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Requirement is published but not yet in force. */
export const isUpcoming = (reg: ScopeRegulation): boolean =>
  !!(reg.effectiveDate && reg.effectiveDate > today());

export interface ProfileSignature {
  state: string;
  medicare: boolean;
  accredited: boolean;
  type: string;
  services: string;
  sel: string;
}

/**
 * A stable fingerprint of everything that determines the requirement set.
 * When it changes, run-over-run numbers stop being comparable.
 */
export function profileSignature(profile: ScopeProfile, selectionKey: string): ProfileSignature {
  return {
    state: profile.state,
    medicare: !!profile.medicare,
    accredited: !!profile.accredited,
    type: profile.facilityType,
    services: SERVICES.map((s) => `${s.key}:${profile.services[s.key] ? 1 : 0}`).join(','),
    sel: selectionKey,
  };
}

export const signaturesMatch = (a: ProfileSignature | null, b: ProfileSignature): boolean =>
  !!a && JSON.stringify(a) === JSON.stringify(b);

/** Human readable explanation of what changed between two signatures. */
export function scopeDiff(a: ProfileSignature | null, b: ProfileSignature): string {
  if (!a) return '';
  const out: string[] = [];
  if (a.state !== b.state) out.push(`State ${a.state} \u2192 ${b.state}`);
  if (a.medicare !== b.medicare) out.push(`Medicare ${b.medicare ? 'added' : 'removed'}`);
  if (a.accredited !== b.accredited) out.push(`Accreditation ${b.accredited ? 'added' : 'removed'}`);
  if (a.type !== b.type) out.push(`Type \u2192 ${b.type}`);
  if (a.sel !== b.sel) {
    out.push(b.sel === 'all' ? 'Selection cleared \u2014 full library' : 'Analysis narrowed to a selection');
  }

  const pa: Record<string, boolean> = {};
  const pb: Record<string, boolean> = {};
  String(a.services)
    .split(',')
    .forEach((x) => {
      const k = x.split(':');
      pa[k[0]] = k[1] === '1';
    });
  String(b.services)
    .split(',')
    .forEach((x) => {
      const k = x.split(':');
      pb[k[0]] = k[1] === '1';
    });
  SERVICES.forEach((s) => {
    if (pa[s.key] !== pb[s.key]) out.push(`${s.name} ${pb[s.key] ? 'added' : 'removed'}`);
  });

  return out.join(' \u00b7 ');
}
