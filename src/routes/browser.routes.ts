import { Router } from 'express';
import { postBrowserSmoke } from '../controllers/browser.controller';

const router = Router();

/**
 * @swagger
 * /api/browser/smoke:
 *   post:
 *     summary: Verify that headless Chromium can launch
 *     description: Launches and closes Chromium without creating a page or navigating to a URL.
 *     tags:
 *       - Browser
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Chromium launched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/BrowserSmokeResult'
 *                 meta:
 *                   $ref: '#/components/schemas/Meta'
 *       401:
 *         description: Missing or invalid bearer token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 *       500:
 *         description: Chromium failed to launch
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.post('/smoke', postBrowserSmoke);

export default router;
