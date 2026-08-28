import { Router } from 'express';
import { PRODUCT_DISCLAIMER, ROLES } from '@policy-prism/shared';
import { authRouter } from '../modules/auth/auth.routes';
import { branchesRouter } from '../modules/branches/branches.routes';
import { hospitalRouter } from '../modules/hospitals/hospitals.routes';
import { policiesRouter } from '../modules/policies/policies.routes';
import { regulationsRouter } from '../modules/regulations/regulations.routes';
import { analysisRouter, dashboardRouter } from '../modules/analysis/analysis.routes';
import { gapsRouter } from '../modules/gaps/gaps.routes';
import { reviewsRouter } from '../modules/reviews/reviews.routes';
import { remediationRouter } from '../modules/remediation/remediation.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { auditRouter } from '../modules/audit/audit.routes';
import { ok } from '../utils/http';

export const api = Router();

/** Machine-readable description of the surface, handy when wiring a client. */
api.get('/', (_req, res) =>
  ok(res, {
    name: 'Policy Prism API',
    version: '1.0.0',
    disclaimer: PRODUCT_DISCLAIMER,
    roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, can: r.can })),
    routes: {
      auth: [
        'POST /api/auth/signup',
        'POST /api/auth/register',
        'POST /api/auth/login',
        'POST /api/auth/forgot-password',
        'POST /api/auth/reset-password',
        'GET /api/auth/me',
        'POST /api/auth/logout',
      ],
      branches: [
        'GET /api/branches',
        'POST /api/branches',
        'PATCH /api/branches/:id',
        'DELETE /api/branches/:id',
      ],
      hospital: ['GET /api/hospital/profile', 'PATCH /api/hospital/profile'],
      policies: [
        'GET /api/policies',
        'GET /api/policies/:id',
        'POST /api/policies',
        'PATCH /api/policies/:id',
        'DELETE /api/policies/:id',
        'POST /api/policies/upload',
        'GET /api/policies/:id/versions',
      ],
      regulations: [
        'GET /api/regulations',
        'GET /api/regulations/:id',
        'POST /api/regulations',
        'PATCH /api/regulations/:id',
        'DELETE /api/regulations/:id',
        'POST /api/regulations/upload',
      ],
      analysis: [
        'POST /api/analysis/run',
        'GET /api/analysis',
        'GET /api/analysis/latest',
        'GET /api/analysis/:id',
        'GET /api/analysis/:id/mappings',
        'GET /api/analysis/:id/policy-check',
        'GET /api/analysis/mapping/:id',
      ],
      dashboard: ['GET /api/dashboard'],
      gaps: ['GET /api/gaps', 'GET /api/gaps/:id', 'PATCH /api/gaps/:id', 'GET /api/gaps/:id/draft'],
      reviews: [
        'GET /api/reviews',
        'GET /api/reviews/summary',
        'POST /api/reviews/:id/approve',
        'POST /api/reviews/:id/reject',
        'POST /api/reviews/:id/reopen',
        'POST /api/reviews/:id/comment',
        'GET /api/reviews/:id/history',
      ],
      remediation: [
        'GET /api/remediation',
        'POST /api/remediation',
        'PATCH /api/remediation/:id',
        'DELETE /api/remediation/:id',
        'POST /api/remediation/bulk-open',
      ],
      reports: ['GET /api/reports/summary', 'GET /api/reports/export', 'GET /api/reports/workspace'],
      audit: ['GET /api/audit', 'GET /api/audit/:seq'],
    },
  }),
);

api.use('/auth', authRouter);
api.use('/branches', branchesRouter);
api.use('/hospital', hospitalRouter);
api.use('/policies', policiesRouter);
api.use('/regulations', regulationsRouter);
api.use('/analysis', analysisRouter);
api.use('/dashboard', dashboardRouter);
api.use('/gaps', gapsRouter);
api.use('/reviews', reviewsRouter);
api.use('/remediation', remediationRouter);
api.use('/reports', reportsRouter);
api.use('/audit', auditRouter);
