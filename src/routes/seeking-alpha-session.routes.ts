import { Router } from 'express';
import {
  postSeekingAlphaSessionCheck,
  postSeekingAlphaSessionImport,
} from '../controllers/seeking-alpha-session.controller';
import { sessionAdminAuthMiddleware } from '../middlewares/session-admin-auth.middleware';

export const seekingAlphaSessionAdminRoutes = Router();
export const seekingAlphaSessionRoutes = Router();

/**
 * @swagger
 * /api/admin/sources/seeking-alpha/session/import:
 *   post:
 *     summary: Import a locally bootstrapped Seeking Alpha browser session
 *     tags: [Seeking Alpha session administration]
 *     security:
 *       - sessionAdminBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Playwright storage state. This secret is never returned or logged.
 *     responses:
 *       201: { description: Session encrypted and persisted }
 *       400: { description: Invalid storage state }
 *       401: { description: Missing or invalid administrative bearer token }
 *       404: { description: Session import is disabled }
 */
seekingAlphaSessionAdminRoutes.post(
  '/session/import',
  sessionAdminAuthMiddleware,
  postSeekingAlphaSessionImport
);

/**
 * @swagger
 * /api/sources/seeking-alpha/session/check:
 *   post:
 *     summary: Verify the persisted Seeking Alpha session
 *     tags: [Seeking Alpha]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Session state is VALID, MISSING, EXPIRED, or CHALLENGE_REQUIRED }
 *       401: { description: Missing or invalid service bearer token }
 *       503: { description: Source disabled, queue full, circuit open, or upstream unavailable }
 */
seekingAlphaSessionRoutes.post('/session/check', postSeekingAlphaSessionCheck);
