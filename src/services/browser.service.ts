import { chromium } from 'playwright';
import logger from '../config/logger';
import env from '../config/env';
import { BrowserSmokeResult } from '../types/api.types';

export class BrowserService {
  async runSmokeCheck(): Promise<BrowserSmokeResult> {
    const startedAt = Date.now();
    logger.info('Starting Chromium launch smoke check');

    const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });

    try {
      const result: BrowserSmokeResult = {
        browser: 'chromium',
        launched: true,
        headless: env.PLAYWRIGHT_HEADLESS,
        version: browser.version(),
      };

      logger.info({
        message: 'Chromium launch smoke check passed',
        durationMs: Date.now() - startedAt,
      });
      return result;
    } finally {
      await browser.close();
    }
  }

  async close(): Promise<void> {
    // Smoke checks own and close their browser process; no shared browser is retained.
  }
}

export const browserService = new BrowserService();
