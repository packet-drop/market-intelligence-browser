import { chromium, Page } from 'playwright';
import env from '../config/env';
import logger from '../config/logger';
import {
  SeekingAlphaSessionCheckResult,
  SeekingAlphaSessionImportResult,
} from '../types/api.types';
import {
  ApprovedSeekingAlphaNavigation,
  InterceptedNavigationState,
  sessionCheckNavigation,
} from './seeking-alpha-navigation';
import {
  SeekingAlphaOperationError,
  SeekingAlphaSessionMetadata,
} from './seeking-alpha-operation-error';
import { PlaywrightStorageState, SeekingAlphaSessionStore } from './seeking-alpha-session-store';
import { QueueFullError, SerializedOperationQueue } from './serialized-operation-queue';

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 15 * 60 * 1000;

interface AuthenticatedOperationResult<T> {
  value: T;
  importedAt: string;
  lastVerifiedAt: string;
}

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

export const pageRequiresChallenge = async (page: Page): Promise<boolean> => {
  try {
    const title = (await page.title()).toLowerCase();
    const body = (await page.locator('body').innerText({ timeout: 5000 })).toLowerCase();
    return /captcha|verify you are human|unusual traffic|security challenge|press\s*&\s*hold|enable javascript and cookies/.test(
      `${title}\n${body}`
    );
  } catch {
    return false;
  }
};

const pageRequiresLogin = async (page: Page): Promise<boolean> =>
  (await page.locator('input[type="password"]').count()) > 0;

const interceptedError = (
  state: InterceptedNavigationState,
  metadata: SeekingAlphaSessionMetadata
): SeekingAlphaOperationError => new SeekingAlphaOperationError(state, metadata);

const checkResultForError = (error: SeekingAlphaOperationError): SeekingAlphaSessionCheckResult => {
  switch (error.operationCode) {
    case 'SOURCE_DISABLED':
      return result('UNAVAILABLE', 'SOURCE_DISABLED');
    case 'SESSION_MISSING':
      return result('MISSING', 'SESSION_FILE_MISSING');
    case 'SESSION_EXPIRED':
      return result('EXPIRED', 'LOGIN_REQUIRED', error.sessionMetadata);
    case 'CHALLENGE_REQUIRED':
      return result('CHALLENGE_REQUIRED', 'UPSTREAM_CHALLENGE', error.sessionMetadata);
    case 'QUEUE_FULL':
      return result('UNAVAILABLE', 'QUEUE_FULL');
    case 'CIRCUIT_OPEN':
      return result('UNAVAILABLE', 'CIRCUIT_OPEN');
    default:
      return result('UNAVAILABLE', 'UPSTREAM_UNAVAILABLE');
  }
};

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
      this.resetCircuit();
      logger.info({ message: 'Seeking Alpha session imported', importedAt });
      return { importedAt };
    });
  }

  async checkSession(): Promise<SeekingAlphaSessionCheckResult> {
    if (this.inFlightCheck) return this.inFlightCheck;

    const checking = this.runCheck();
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

  async runAuthenticatedOperation<T>(
    navigation: ApprovedSeekingAlphaNavigation,
    operation: (page: Page) => Promise<T>
  ): Promise<T> {
    const completed = await this.runQueuedOperation(navigation, operation);
    return completed.value;
  }

  private async runCheck(): Promise<SeekingAlphaSessionCheckResult> {
    try {
      const checked = await this.runQueuedOperation(sessionCheckNavigation, async () => undefined);
      return result('VALID', undefined, checked);
    } catch (error) {
      if (error instanceof SeekingAlphaOperationError) return checkResultForError(error);
      logger.error({ message: 'Seeking Alpha session check unavailable' });
      return result('UNAVAILABLE', 'UPSTREAM_UNAVAILABLE');
    }
  }

  private async runQueuedOperation<T>(
    navigation: ApprovedSeekingAlphaNavigation,
    operation: (page: Page) => Promise<T>
  ): Promise<AuthenticatedOperationResult<T>> {
    if (!this.enabled || !this.store) throw new SeekingAlphaOperationError('SOURCE_DISABLED');
    if (Date.now() < this.circuitOpenUntil) throw new SeekingAlphaOperationError('CIRCUIT_OPEN');

    try {
      return await this.queue.run(async () => this.performOperation(navigation, operation));
    } catch (error) {
      if (error instanceof QueueFullError) throw new SeekingAlphaOperationError('QUEUE_FULL');
      throw error;
    }
  }

  private async performOperation<T>(
    navigation: ApprovedSeekingAlphaNavigation,
    operation: (page: Page) => Promise<T>
  ): Promise<AuthenticatedOperationResult<T>> {
    try {
      const session = await this.store?.load();
      if (!session) {
        this.resetCircuit();
        throw new SeekingAlphaOperationError('SESSION_MISSING');
      }

      const browser = await chromium.launch({ headless: env.PLAYWRIGHT_HEADLESS });
      try {
        const context = await browser.newContext({ storageState: session.storageState });
        try {
          const page = await context.newPage();
          let interceptedState: InterceptedNavigationState | null = null;

          await page.route('**/*', async (route) => {
            const request = route.request();
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
              const classification = navigation.classify(request.url());
              if (classification) {
                interceptedState = classification;
                await route.abort('blockedbyclient');
                return;
              }
            }
            await route.continue();
          });

          try {
            await page.goto(navigation.url, {
              waitUntil: 'domcontentloaded',
              timeout: env.SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS,
            });
          } catch {
            if (interceptedState) throw interceptedError(interceptedState, session);
            throw new Error('Approved Seeking Alpha navigation failed');
          }

          const finalClassification = navigation.classify(page.url());
          if (finalClassification) throw interceptedError(finalClassification, session);
          if (await pageRequiresLogin(page)) {
            throw new SeekingAlphaOperationError('SESSION_EXPIRED', session);
          }
          if (await pageRequiresChallenge(page)) {
            throw new SeekingAlphaOperationError('CHALLENGE_REQUIRED', session);
          }

          const value = await operation(page);
          const lastVerifiedAt = new Date().toISOString();
          await this.store?.save({
            storageState: await context.storageState(),
            importedAt: session.importedAt,
            lastVerifiedAt,
          });
          this.resetCircuit();
          return { value, importedAt: session.importedAt, lastVerifiedAt };
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    } catch (error) {
      if (error instanceof SeekingAlphaOperationError) {
        if (error.operationCode === 'UPSTREAM_UNAVAILABLE') this.recordUpstreamFailure();
        else this.resetCircuit();
        throw error;
      }
      this.recordUpstreamFailure();
      logger.error({ message: 'Seeking Alpha operation unavailable' });
      throw new SeekingAlphaOperationError('UPSTREAM_UNAVAILABLE');
    }
  }

  private resetCircuit(): void {
    this.consecutiveUpstreamFailures = 0;
    this.circuitOpenUntil = 0;
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
