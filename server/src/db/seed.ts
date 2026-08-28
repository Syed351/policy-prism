import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { RoleKey, SERVICES } from '@policy-prism/shared';
import { env } from '../config/env';
import { closeDb, db } from './index';
import {
  analysisRuns,
  auditLogs,
  gapFindings,
  hospitals,
  organizations,
  hospitalServices,
  policies,
  policyMappings,
  policyVersions,
  regulations,
  remediationItems,
  reviews,
  users,
} from './schema';
import { SEED_POLICIES, SEED_REGULATIONS } from './seed-data';

interface SeedUser {
  email: string;
  name: string;
  role: RoleKey;
}

/** Demo accounts. Names match the prototype's sign-in card. */
const SEED_USERS: SeedUser[] = [
  { email: 'admin@policyprism.demo', name: 'M. Adeel', role: 'admin' },
  { email: 'reviewer@policyprism.demo', name: 'S. Karim', role: 'reviewer' },
  { email: 'analyst@policyprism.demo', name: 'J. Novak', role: 'analyst' },
  { email: 'auditor@policyprism.demo', name: 'R. Osei', role: 'viewer' },
];

/** Riverbend Regional Medical Center - the prototype's default facility. */
const SEED_HOSPITAL = {
  name: 'Riverbend Regional Medical Center',
  beds: 312,
  state: 'OH',
  facilityType: 'Acute care hospital',
  licenseType: 'General acute care license',
  medicare: true,
  accredited: true,
  services: { ed: true, lab: true, psych: false, ob: false, swing: false } as Record<string, boolean>,
};

async function wipe(): Promise<void> {
  // Truncate rather than delete so identity sequences restart from 1 and the
  // demo data always gets the same IDs.
  await db.execute(sql`
    TRUNCATE TABLE
      ${auditLogs}, ${remediationItems}, ${reviews}, ${gapFindings}, ${policyMappings},
      ${analysisRuns}, ${policyVersions}, ${policies}, ${regulations},
      ${hospitalServices}, ${users}, ${hospitals}, ${organizations}
    RESTART IDENTITY CASCADE
  `);
}

async function main(): Promise<void> {
  const password = env.SEED_PASSWORD;

  // eslint-disable-next-line no-console
  console.log('[seed] clearing existing data');
  await wipe();

  // ---- hospital -------------------------------------------------------
  // One organisation owning the demo branches.
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Riverbend Health System' })
    .returning();

  const [hospital] = await db
    .insert(hospitals)
    .values({
      organizationId: org.id,
      branchLabel: 'Riverbend Main',
      isPrimary: true,
      name: SEED_HOSPITAL.name,
      beds: SEED_HOSPITAL.beds,
      state: SEED_HOSPITAL.state,
      facilityType: SEED_HOSPITAL.facilityType,
      licenseType: SEED_HOSPITAL.licenseType,
      medicare: SEED_HOSPITAL.medicare,
      accredited: SEED_HOSPITAL.accredited,
    })
    .returning();
  // eslint-disable-next-line no-console
  console.log(`[seed] hospital #${hospital.id} ${hospital.name}`);

  await db.insert(hospitalServices).values(
    SERVICES.map((s) => ({
      hospitalId: hospital.id,
      serviceKey: s.key,
      enabled: !!SEED_HOSPITAL.services[s.key],
    })),
  );

  // ---- users ----------------------------------------------------------
  const passwordHash = await bcrypt.hash(password, 12);
  const insertedUsers = await db
    .insert(users)
    .values(
      SEED_USERS.map((u) => ({
        hospitalId: hospital.id,
        organizationId: org.id,
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        isActive: true,
      })),
    )
    .returning();
  // eslint-disable-next-line no-console
  console.log(`[seed] ${insertedUsers.length} users`);

  const admin = insertedUsers.find((u) => u.role === 'admin')!;

  // ---- regulations ----------------------------------------------------
  const insertedRegs = await db
    .insert(regulations)
    .values(
      SEED_REGULATIONS.map((r) => ({
        hospitalId: hospital.id,
        framework: r.framework,
        citation: r.citation,
        title: r.title,
        requirementText: r.requirementText,
        applicability: r.applicability,
        effectiveDate: r.effectiveDate ?? null,
        sourceRef: r.sourceRef ?? null,
        source: 'demo' as const,
      })),
    )
    .returning();
  // eslint-disable-next-line no-console
  console.log(`[seed] ${insertedRegs.length} regulatory requirements`);

  // ---- policies -------------------------------------------------------
  const insertedPolicies = await db
    .insert(policies)
    .values(
      SEED_POLICIES.map((p) => ({
        hospitalId: hospital.id,
        code: p.code,
        title: p.title,
        owner: p.owner,
        version: p.version,
        effectiveDate: p.effectiveDate,
        scope: p.scope,
        status: 'active' as const,
        text: p.text,
        source: 'demo' as const,
        createdById: admin.id,
      })),
    )
    .returning();
  // eslint-disable-next-line no-console
  console.log(`[seed] ${insertedPolicies.length} policies`);

  // ---- an initial version row per policy ------------------------------
  await db.insert(policyVersions).values(
    insertedPolicies.map((p) => ({
      policyId: p.id,
      version: p.version,
      text: p.text,
      effectiveDate: p.effectiveDate,
      authorId: admin.id,
      authorName: admin.name,
      supersededAt: null,
    })),
  );

  // ---- a couple of realistic prior revisions --------------------------
  const utility = insertedPolicies.find((p) => p.code === 'EC-950');
  if (utility) {
    await db.insert(policyVersions).values({
      policyId: utility.id,
      version: '1.0',
      text:
        'Riverbend maintains its utility systems. Maintenance is performed by the plant operations ' +
        'department on a schedule set by the director.',
      effectiveDate: '2018-06-01',
      supersededAt: new Date('2021-04-12T09:00:00Z'),
      authorId: admin.id,
      authorName: admin.name,
    });
  }

  // ---- audit trail ----------------------------------------------------
  const entries = [
    { category: 'system' as const, action: 'Workspace initialised', object: hospital.name, detail: 'Demo corpus loaded' },
    {
      category: 'profile' as const,
      action: 'Facility profile created',
      object: hospital.name,
      detail: `${hospital.beds} beds \u00b7 ${hospital.facilityType} \u00b7 ${hospital.state} \u00b7 Medicare \u00b7 Accredited`,
    },
    {
      category: 'document' as const,
      action: 'Imported regulatory library',
      object: 'Demo corpus',
      detail: `${insertedRegs.length} requirements across CMS, HIPAA, EMTALA, CLIA, TJC and Ohio state licensure`,
    },
    {
      category: 'document' as const,
      action: 'Imported policy set',
      object: 'Demo corpus',
      detail: `${insertedPolicies.length} policies`,
    },
  ];

  let seq = 0;
  for (const e of entries) {
    seq += 1;
    await db.insert(auditLogs).values({
      hospitalId: hospital.id,
      seq,
      category: e.category,
      action: e.action,
      object: e.object,
      detail: e.detail,
      userId: admin.id,
      actorName: admin.name,
      actorRole: 'Compliance manager',
    });
  }

  // eslint-disable-next-line no-console
  console.log(`
[seed] complete.

  Facility     ${hospital.name} (${hospital.state}, ${hospital.beds} beds)
  Requirements ${insertedRegs.length}
  Policies     ${insertedPolicies.length}

  Demo accounts (all use the same password):

    admin@policyprism.demo      Compliance manager
    reviewer@policyprism.demo   Compliance reviewer
    analyst@policyprism.demo    Policy analyst
    auditor@policyprism.demo    Auditor (read only)

    password: ${password}

  Sign in and press "Run analysis" to produce the first coverage report.
`);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
