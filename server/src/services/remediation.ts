/**
 * Remediation engine.
 *
 * Turns an open finding into something a compliance team can act on: what to
 * do, who should own it, what the policy set does not say, and a first draft in
 * policy voice. Ported from the prototype's `remediate()` / `draftPolicy()`.
 */

import {
  CoverageStatus,
  FindingFlag,
  Framework,
  FW_RISK,
  FW_WEIGHT,
  isGap,
  Priority,
} from '@policy-prism/shared';
import { tok } from './engine';

export interface RemediationRegulation {
  framework: string;
  citation: string;
  title: string;
  requirementText: string;
}

export interface RemediationPolicy {
  id: number;
  code: string;
  title: string;
  owner: string;
  version: string;
}

export interface RemediationFinding {
  status: CoverageStatus;
  score: number;
  missing: string[];
  flags: FindingFlag[];
}

export interface RemediationOutput {
  action: string;
  effort: string;
  priority: Priority;
  owner: string;
  risk: string;
  targetPolicyId: number | null;
  targetPolicyCode: string | null;
  targetPolicyVersion: string | null;
  missingTerms: string[];
  uncoveredClauses: string[];
  steps: string[];
  draft: string;
}

/** Department routing hints, in priority order. First regex to match wins. */
const OWNER_HINT: Array<[RegExp, string]> = [
  [/ventilat|humidity|air exchange|temperature control|light|hvac|plant operation|utility system/i, 'Facilities and Plant Operations'],
  [/radiolog|radiat|imaging|shielding|x-ray/i, 'Radiology'],
  [/respiratory|ventilat(or|ion of the airway)|blood gas|oxygen|airway/i, 'Respiratory Care'],
  [/physical access|facility security|premises|badge|door|visitor/i, 'Facilities and Security'],
  [/laborator|specimen|analytic|reagent|proficiency test/i, 'Clinical Laboratory'],
  [/emergency department|medical screening|on call|stabiliz|women in labor/i, 'Emergency Services'],
  [/electronic protected health|encrypt|password|audit log|workstation|malicious|access right|transmission|backup|media/i, 'Information Security'],
  [/privacy|disclosure|breach|minimum necessary|confidential/i, 'Privacy Office'],
  [/nurse|nursing|staffing|shift/i, 'Chief Nursing Officer'],
  [/infection|hygiene|sanitat|housekeep|waste/i, 'Infection Prevention'],
  [/drug|medication|pharmacy|biological|controlled substance|dispens/i, 'Pharmacy'],
  [/medical record|documentation|retention|chart/i, 'Health Information Management'],
  [/quality|performance improvement|adverse event|grievance|incident|abuse/i, 'Quality and Safety'],
  [/disaster|evacuation|preparedness|fire|emergency management/i, 'Safety and Emergency Management'],
  [/restraint|seclusion|patient right|care plan|discharge/i, 'Patient Experience'],
];

export function suggestOwner(text: string, fallback?: string): string {
  for (const [re, dept] of OWNER_HINT) {
    if (re.test(text)) return dept;
  }
  return fallback || 'Compliance';
}

/** Split requirement text into sentences long enough to be a provision. */
export function sentences(t: string): string[] {
  return String(t)
    .split(/(?<=[.;])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 25);
}

/** Provisions of the requirement whose vocabulary is missing from the policy. */
export function uncoveredClauses(requirementText: string, missing: string[]): string[] {
  if (!missing.length) return [];
  return sentences(requirementText)
    .filter((s) => {
      const st = tok(s);
      return missing.some((m) => st.indexOf(m) >= 0);
    })
    .slice(0, 4);
}

/** Rewrite regulatory prose into first-person policy voice. */
export function toPolicyVoice(s: string, facility: string): string {
  return s
    .replace(/^The hospital must\b/, `${facility} shall`)
    .replace(/^The (laboratory|nursing service|medical staff|utilization review plan)\b/, (_m, a: string) => `The ${a}`)
    .replace(/^Implement\b/, `${facility} implements`)
    .replace(/^Establish and implement\b/, `${facility} establishes and maintains`)
    .replace(/^Each (hospital|facility)\b/, facility)
    .replace(/^If an individual\b/, 'When an individual')
    .replace(/\bmust be\b/g, 'shall be')
    .replace(/\bmust have\b/g, 'shall have')
    .replace(/\bmust not\b/g, 'shall not')
    .replace(/\bmust\b/g, 'shall');
}

export function draftPolicy(
  reg: RemediationRegulation,
  owner: string,
  facilityName: string,
): string {
  const facility = facilityName || 'The hospital';
  const norm = (x: string) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const tnorm = norm(reg.title);

  const body = sentences(reg.requirementText)
    .filter((s) => (norm(s) !== tnorm && norm(s).indexOf(tnorm) !== 0) || norm(s).length > tnorm.length + 30)
    .map((s) => toPolicyVoice(s, facility));

  return (
    `PURPOSE\nTo establish requirements that satisfy ${reg.citation} (${reg.framework}) \u2014 ${reg.title}.\n\n` +
    `SCOPE\nAll departments and workforce members of ${facility}.\n\n` +
    `POLICY\n${body.map((s) => `\u2022 ${s}`).join('\n')}\n\n` +
    `RESPONSIBILITY\n${owner} owns this policy and reviews it at least annually.\n\n` +
    'EVIDENCE OF COMPLIANCE\nRetain documentation demonstrating each provision above is performed, ' +
    'sufficient to present to a surveyor on request.\n\n' +
    `REFERENCE\n${reg.citation} \u2014 ${reg.title}`
  );
}

/** Build a full remediation plan for one open finding. */
export function remediate(
  finding: RemediationFinding,
  reg: RemediationRegulation,
  matchedPolicy: RemediationPolicy | null,
  facilityName: string,
): RemediationOutput {
  const fw = (reg.framework as Framework) in FW_WEIGHT ? (reg.framework as Framework) : 'Custom';
  const weight = FW_WEIGHT[fw];

  let action: string;
  let effort: string;
  let target: RemediationPolicy | null = null;

  if (finding.status === 'no_policy') {
    action = 'Write a new policy';
    effort = 'New document';
  } else if (finding.status === 'not_addressed') {
    action = 'Rewrite and expand an existing policy';
    effort = 'Major revision';
    target = matchedPolicy;
  } else {
    action = 'Amend an existing policy';
    effort = 'Clause addition';
    target = matchedPolicy;
  }

  const hasConflict = finding.flags.includes('conflict');
  const priority: Priority =
    (isGap(finding.status) && weight >= 3) || hasConflict
      ? 'Critical'
      : isGap(finding.status) || weight >= 3
        ? 'High'
        : 'Medium';

  const owner = target ? target.owner : suggestOwner(reg.requirementText);
  const clauses = uncoveredClauses(reg.requirementText, finding.missing);
  const terms = finding.missing.slice(0, 6);

  const steps: string[] = [];
  if (hasConflict) {
    steps.push(
      'Read the matched policy first \u2014 it uses this requirement\u2019s language in a negative statement and may contradict the rule.',
    );
  }
  if (finding.flags.includes('stale')) {
    steps.push('The policy is past its review date. Route it through review even if the wording still satisfies the rule.');
  }
  if (target) {
    steps.push(`Open ${target.code || target.title} v${target.version} and add the provisions listed below.`);
  } else {
    steps.push(`Draft a new policy covering ${reg.title.toLowerCase()}, using the language below as a starting point.`);
  }
  steps.push(`Assign ownership to ${owner} and set a review cadence of at least annually.`);
  steps.push('Route through your normal policy approval path and record the approval date.');
  steps.push('Define the evidence a surveyor would ask for, and name where it is retained.');
  steps.push('Re-upload the revised policy here and re-run the analysis to confirm the gap closes.');

  return {
    action,
    effort,
    priority,
    owner,
    risk: FW_RISK[fw],
    targetPolicyId: target ? target.id : null,
    targetPolicyCode: target ? target.code || target.title : null,
    targetPolicyVersion: target ? target.version : null,
    missingTerms: terms,
    uncoveredClauses: clauses,
    steps,
    draft: draftPolicy(reg, owner, facilityName),
  };
}
