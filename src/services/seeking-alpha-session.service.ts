import { chromium, Page } from 'playwright';
import env from '../config/env';
import logger from '../config/logger';
import {
  SeekingAlphaSessionCheckResult,
  SeekingAlphaSessionImportResult,
} from '../types/api.types';
import { PlaywrightStorageState, SeekingAlphaSessionStore } from './seeking-alpha-session-store';
import { QueueFullError, SerializedOperationQueue } from './serialized-operation-queue';

const VERIFY_URL = 'https://seekingalpha.com/account/edit_price_alerts?tab=history';
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 15 * 60 * 1000;

type InterceptedState = 'EXPIRED' | 'CHALLENGE_REQUIRED' | 'UNAVAILABLE';

const result = (
  state: SeekingAlphaSessionCheckResult['state'],
  reason?: SeekingAlphaSessionCheckResult['reason'],
  metadata?: { importedAt?: string; lastVerifiedAt?: string }
): SeekingAlphaSessionCheckResult => ({
  state,
  checkedAt: new Date().toISOString(),
  ...(metadata?.importedAt ? { importedAt: metadata.importedAt } : {}),
  ...(metadata?.lastVerifiedAt ? { lastVerifiedAt: metadata.lastVerifiedAt } : {}),
  ...(reason ? { reason } : {}),
});

const classifyPath = (urlValue: string): InterceptedState | null => {
  try {
    const url = new URL(urlValue);
    if (url.origin !== 'https://seekingalpha.com') return 'UNAVAILABLE';
    if (url.pathname === '/account/login' || url.pathname.startsWith('/login')) return 'EXPIRED';
    if (/captcha|challenge|verify/i.test(url.pathname)) return 'CHALLENGE_REQUIRED';
    if (
      url.pathname !== '/account/edit_price_alerts' ||
      url.searchParams.get('tab') !== 'history'
    ) {
      return 'UNAVAILABLE';
    }
    return null;
  } catch {
    return 'UNAVAILABLE';
  }
};

const pageRequiresChallenge = async (page: Page): Promise<boolean> => {
  const title = (await page.title()).toLowerCase();
  const body = (await page.locator('body').innerText({ timeout: 5000 })).toLowerCase();
  return /captcha|verify you are human|unusual traffic|security challenge/.test(
    `${title}\n${body}`
  );
};

const pageRequiresLogin = async (page: Page): Promise<boolean> =>
  (await page.locator('input[type="password"]').count()) > 0;

export class SeekingAlphaSessionService {
  private consecutiveUpstreamFailures = 0;
  private circuitOpenUntil = 0;
  private inFlightCheck: Promise<SeekingAlphaSessionCheckResult> | null = null;

  constructor(
    private readonly store: SeekingAlphaSessionStore | null,
    private readonly enabled: boolean,
    private readonly queue = new SerializedOperationQueue(
      env.SEEKING_ALPHA_MAX_QUEUE_SIZE,
      env.SEEKING_ALPHA_MIN_NAVIGATION_INTERVAL_MS
    )
  ) {}

  async initialize(): Promise<void> {
    if (this.enabled || env.SEEKING_ALPHA_SESSION_IMPORT_ENABLED) {
      if (!this.store) throw new Error('Seeking Alpha session persistence is not configured');
      await this.store.verifyWritable();
    }
  }

  async importSession(
    storageState: PlaywrightStorageState
  ): Promise<SeekingAlphaSessionImportResult> {
    if (!this.store) throw new Error('Seeking Alpha session persistence is not configured');
    return this.queue.run(async () => {
      const importedAt = new Date().toISOString();
      await this.store?.save({ storageState, importedAt });
      this.consecutiveUpstreamFailures = 0;
      this.circuitOpenUntil = 0;
      logger.info({ message: 'Seeking Alpha session imported', importedAt });
      return { importedAt };
    });
  }

  async checkSession(): Promise<SeekingAlphaSessionCheckResult> {
    if (!this.enabled || !this.store) return result('UNAVAILABLE', 'SOURCE_DISABLED');
    if (Date.now() < this.circuitOpenUntil) return result('UNAVAILABLE', 'CIRCUIT_OPEN');
    if (this.inFlightCheck) return this.inFlightCheck;

    const checking = this.runQueuedCheck();
    this.inFlightCheck = checking;
    void checking.then(
      () => {
        if (this.inFlightCheck === checking) this.inFlightCheck = null;
      },
      () => {
        if (this.inFlightCheck === checking) this.inFlightCheck = null;
      }
    );
    return checking;
  }

  private async runQueuedCheck(): Promise<SeekingAlphaSessionCheckResult> {
    try {
      return await this.queue.run(async () => this.performCheck());
    } catch (error) {
      if (error instanceof QueueFullError) return result('UNAVAILABLE', 'QUEUE_FULL');
      this.recordUpstreamFailure();
      logger.error({ message: 'Seeking Alpha session check unavailable' });
      return result('UNAVAILABLE', 'UPSTREAM_UNAVAILABLE');
    }
  }

  private async performCheck(): Promise<SeekingAlphaSessionCheckResult> {
    const session = await this.store?.load();
    if (!session) return result('MISSING', 'SESSION_FILE_MISSING');

    const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
    try {
      const context = await browser.newContext({ storageState: session.storageState });
      try {
        const page = await context.newPage();
        let interceptedState: InterceptedState | null = null;

        await page.route('**/*', async (route) => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            const classification = classifyPath(request.url());
            if (classification) {
              interceptedState = classification;
              await route.abort('blockedbyclient');
              return;
            }
          }
          await route.continue();
        });

        try {
          await page.goto(VERIFY_URL, {
            waitUntil: 'domcontentloaded',
            timeout: env.SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS,
          });
        } catch {
          if (interceptedState === 'EXPIRED') {
            this.consecutiveUpstreamFailures = 0;
            return result('EXPIRED', 'LOGIN_REQUIRED', session);
          }
          if (interceptedState === 'CHALLENGE_REQUIRED') {
            this.consecutiveUpstreamFailures = 0;
            return result('CHALLENGE_REQUIRED', 'UPSTREAM_CHALLENGE', session);
          }
          throw new Error('Verification navigation failed');
        }

        const finalClassification = classifyPath(page.url());
        if (finalClassification === 'EXPIRED' || (await pageRequiresLogin(page))) {
          this.consecutiveUpstreamFailures = 0;
          return result('EXPIRED', 'LOGIN_REQUIRED', session);
        }
        if (finalClassification === 'CHALLENGE_REQUIRED' || (await pageRequiresChallenge(page))) {
          this.consecutiveUpstreamFailures = 0;
          return result('CHALLENGE_REQUIRED', 'UPSTREAM_CHALLENGE', session);
        }
        if (finalClassification === 'UNAVAILABLE') {
          throw new Error('Verification destination was not approved');
        }

        const lastVerifiedAt = new Date().toISOString();
        await this.store?.save({
          storageState: await context.storageState(),
          importedAt: session.importedAt,
          lastVerifiedAt,
        });
        this.consecutiveUpstreamFailures = 0;
        return result('VALID', undefined, { importedAt: session.importedAt, lastVerifiedAt });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }

  private recordUpstreamFailure(): void {
    this.consecutiveUpstreamFailures += 1;
    if (this.consecutiveUpstreamFailures >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    }
  }
}

const sessionStore = env.SEEKING_ALPHA_SESSION_ENCRYPTION_KEY
  ? new SeekingAlphaSessionStore(
      env.SEEKING_ALPHA_SESSION_PATH,
      env.SEEKING_ALPHA_SESSION_ENCRYPTION_KEY
    )
  : null;

export const seekingAlphaSessionService = new SeekingAlphaSessionService(
  sessionStore,
  env.SEEKING_ALPHA_ENABLED
);
