import { Router } from 'express';
import {
  postSeekingAlphaSessionCheck,
  postSeekingAlphaSessionImport,
} from '../controllers/seeking-alpha-session.controller';
import { postSeekingAlphaQuantRatingLookup } from '../controllers/seeking-alpha-quant.controller';
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

/**
 * @swagger
 * /api/sources/seeking-alpha/quant-ratings/lookup:
 *   post:
 *     summary: Read the hydrated Seeking Alpha Quant Rating for a ticker
 *     tags: [Seeking Alpha]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [ticker]
 *             properties:
 *               ticker:
 *                 type: string
 *                 pattern: '^(?=.{1,15}$)[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$'
 *                 example: AAPL
 *     responses:
 *       200:
 *         description: Hydrated Quant Rating and observed price
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data, meta]
 *               properties:
 *                 success: { type: boolean, enum: [true] }
 *                 data: { $ref: '#/components/schemas/SeekingAlphaQuantRatingResult' }
 *                 meta: { $ref: '#/components/schemas/Meta' }
 *       400: { description: Invalid ticker }
 *       401: { description: Missing or invalid service bearer token }
 *       409: { description: Session missing, expired, or requires manual verification }
 *       422: { description: Ticker has no supported Quant Rating }
 *       502: { description: Seeking Alpha page structure changed }
 *       503: { description: Source disabled, queue full, circuit open, or upstream unavailable }
 *       504: { description: Hydrated values did not become available before the timeout }
 */
seekingAlphaSessionRoutes.post('/quant-ratings/lookup', postSeekingAlphaQuantRatingLookup);
