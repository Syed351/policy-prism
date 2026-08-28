import { eq } from 'drizzle-orm';
import { HospitalProfile, SERVICES, ServiceKey } from '@policy-prism/shared';
import { db } from '../db';
import { hospitals, hospitalServices } from '../db/schema';
import { ApiError } from '../utils/http';
import type { ScopeProfile } from './scope';

export async function getHospital(hospitalId: number) {
  const [row] = await db.select().from(hospitals).where(eq(hospitals.id, hospitalId)).limit(1);
  if (!row) throw ApiError.notFound('Facility not found');
  return row;
}

export async function getServices(hospitalId: number): Promise<Record<ServiceKey, boolean>> {
  const rows = await db
    .select()
    .from(hospitalServices)
    .where(eq(hospitalServices.hospitalId, hospitalId));

  const map = {} as Record<ServiceKey, boolean>;
  SERVICES.forEach((s) => {
    map[s.key] = false;
  });
  rows.forEach((r) => {
    map[r.serviceKey] = r.enabled;
  });
  return map;
}

export async function getProfile(hospitalId: number): Promise<HospitalProfile> {
  const [row, services] = await Promise.all([getHospital(hospitalId), getServices(hospitalId)]);
  return {
    id: row.id,
    name: row.name,
    beds: row.beds,
    state: row.state,
    facilityType: row.facilityType,
    licenseType: row.licenseType,
    medicare: row.medicare,
    accredited: row.accredited,
    services,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The subset of the profile the scope rules actually consult. */
export function toScopeProfile(profile: HospitalProfile): ScopeProfile {
  return {
    state: profile.state,
    medicare: profile.medicare,
    accredited: profile.accredited,
    facilityType: profile.facilityType,
    services: profile.services,
  };
}

export async function getScopeProfile(hospitalId: number): Promise<ScopeProfile> {
  return toScopeProfile(await getProfile(hospitalId));
}
