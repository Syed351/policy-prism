import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  FACILITY_TYPES,
  SERVICE_KEYS,
  SERVICES,
  STATES,
} from '@policy-prism/shared';
import { db } from '../../db';
import { hospitals, hospitalServices, regulations } from '../../db/schema';
import { auth, requireAuth, requirePermission } from '../../middleware/auth';
import { validateBody } from '../../middleware/error';
import { safeAudit } from '../../services/audit';
import { getProfile, toScopeProfile } from '../../services/hospital';
import { applies } from '../../services/scope';
import { asyncHandler, ok } from '../../utils/http';

export const hospitalRouter = Router();

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Facility name is required').max(200),
  beds: z.coerce.number().int().min(0).max(5000),
  state: z.enum(STATES),
  facilityType: z.string().trim().min(2).max(120),
  licenseType: z.string().trim().min(2).max(120),
  medicare: z.boolean(),
  accredited: z.boolean(),
  services: z.record(z.enum(SERVICE_KEYS), z.boolean()),
});

/** GET /api/hospital/profile */
hospitalRouter.get(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const profile = await getProfile(a.hospitalId);

    // Show the user what this profile brings into scope right now.
    const regs = await db.select().from(regulations).where(eq(regulations.hospitalId, a.hospitalId));
    const scopeProfile = toScopeProfile(profile);
    const inScope = regs.filter((r) => applies(r, scopeProfile));
    const frameworks = [...new Set(inScope.map((r) => r.framework))];

    return ok(res, {
      profile,
      scope: {
        inScopeCount: inScope.length,
        libraryCount: regs.length,
        frameworks,
        hasStateLibrary: regs.some((r) => r.applicability === `state:${profile.state}`),
      },
      options: {
        states: STATES,
        facilityTypes: FACILITY_TYPES,
        services: SERVICES,
      },
    });
  }),
);

/**
 * PATCH /api/hospital/profile
 * Changing the profile changes which requirements apply, so this is gated on
 * the `profile` permission and always written to the audit trail.
 */
hospitalRouter.patch(
  '/profile',
  requireAuth,
  requirePermission('profile'),
  validateBody(profileSchema.partial()),
  asyncHandler(async (req, res) => {
    const a = auth(req);
    const body = req.body as Partial<z.infer<typeof profileSchema>>;

    const before = await getProfile(a.hospitalId);

    const hospitalPatch: Record<string, unknown> = { updatedAt: new Date() };
    (['name', 'beds', 'state', 'facilityType', 'licenseType', 'medicare', 'accredited'] as const).forEach(
      (k) => {
        if (body[k] !== undefined) hospitalPatch[k] = body[k];
      },
    );

    if (Object.keys(hospitalPatch).length > 1) {
      await db.update(hospitals).set(hospitalPatch).where(eq(hospitals.id, a.hospitalId));
    }

    if (body.services) {
      for (const [key, enabled] of Object.entries(body.services)) {
        const serviceKey = key as (typeof SERVICE_KEYS)[number];
        const [existing] = await db
          .select()
          .from(hospitalServices)
          .where(
            and(
              eq(hospitalServices.hospitalId, a.hospitalId),
              eq(hospitalServices.serviceKey, serviceKey),
            ),
          )
          .limit(1);

        if (existing) {
          await db
            .update(hospitalServices)
            .set({ enabled: !!enabled, updatedAt: new Date() })
            .where(eq(hospitalServices.id, existing.id));
        } else {
          await db
            .insert(hospitalServices)
            .values({ hospitalId: a.hospitalId, serviceKey, enabled: !!enabled });
        }
      }
    }

    const after = await getProfile(a.hospitalId);

    // Describe the change in the words the user would use.
    const changes: string[] = [];
    if (before.name !== after.name) changes.push(`Name \u2192 ${after.name}`);
    if (before.beds !== after.beds) changes.push(`Beds ${before.beds} \u2192 ${after.beds}`);
    if (before.state !== after.state) changes.push(`State ${before.state} \u2192 ${after.state}`);
    if (before.facilityType !== after.facilityType) changes.push(`Type \u2192 ${after.facilityType}`);
    if (before.licenseType !== after.licenseType) changes.push(`License \u2192 ${after.licenseType}`);
    if (before.medicare !== after.medicare) changes.push(`Medicare ${after.medicare ? 'added' : 'removed'}`);
    if (before.accredited !== after.accredited) {
      changes.push(`Accreditation ${after.accredited ? 'added' : 'removed'}`);
    }
    SERVICES.forEach((s) => {
      if (before.services[s.key] !== after.services[s.key]) {
        changes.push(`${s.name} ${after.services[s.key] ? 'added' : 'removed'}`);
      }
    });

    const regs = await db.select().from(regulations).where(eq(regulations.hospitalId, a.hospitalId));
    const beforeScope = regs.filter((r) => applies(r, toScopeProfile(before))).length;
    const afterScope = regs.filter((r) => applies(r, toScopeProfile(after))).length;

    await safeAudit({
      hospitalId: a.hospitalId,
      category: 'profile',
      action: 'Updated facility profile',
      object: after.name,
      detail:
        (changes.length ? changes.join(' \u00b7 ') : 'No effective change') +
        ` \u00b7 requirements in scope ${beforeScope} \u2192 ${afterScope}`,
      actor: a,
      ip: req.ip,
    });

    return ok(res, {
      profile: after,
      changes,
      scope: { before: beforeScope, after: afterScope, changed: beforeScope !== afterScope },
      note:
        beforeScope !== afterScope
          ? 'The requirement set changed. Re-run the analysis \u2014 previous run numbers are no longer comparable.'
          : null,
    });
  }),
);
