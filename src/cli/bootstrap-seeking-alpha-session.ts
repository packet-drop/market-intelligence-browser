import { BrowserContext, chromium } from 'playwright';
import { createInterface } from 'readline';

const LOGIN_URL = 'https://seekingalpha.com/account/login';
const IMPORT_PATH = '/api/admin/sources/seeking-alpha/session/import';

type CapturedStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

const minimizeStorageState = (state: CapturedStorageState): CapturedStorageState => ({
  cookies: state.cookies.filter(
    (cookie) => cookie.domain === 'seekingalpha.com' || cookie.domain === '.seekingalpha.com'
  ),
  origins: state.origins.filter((origin) => origin.origin === 'https://seekingalpha.com'),
});

const waitForEnter = (): Promise<void> => {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    terminal.question(
      'Complete the Seeking Alpha login in the browser, then press Enter here to import the session. ',
      () => {
        terminal.close();
        resolve();
      }
    );
  });
};

const resolveImportUrl = (serviceOrigin: string): URL => {
  const origin = new URL(serviceOrigin);
  const isLocalHttp =
    origin.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(origin.hostname);
  if (origin.protocol !== 'https:' && !isLocalHttp) {
    throw new Error('The service origin must use HTTPS (HTTP is allowed only for localhost)');
  }
  if (origin.username || origin.password || origin.search || origin.hash) {
    throw new Error('Provide only the Railway service origin, without credentials or query values');
  }
  return new URL(IMPORT_PATH, origin.origin);
};

const main = async (): Promise<void> => {
  const serviceOrigin = process.argv[2];
  const adminKey = process.env.SEEKING_ALPHA_SESSION_ADMIN_KEY;
  if (!serviceOrigin) {
    throw new Error('Usage: npm run session:bootstrap -- https://your-service.example');
  }
  if (!adminKey) {
    throw new Error('SEEKING_ALPHA_SESSION_ADMIN_KEY must be set in the local environment');
  }

  const importUrl = resolveImportUrl(serviceOrigin);
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await waitForEnter();

    const storageState = minimizeStorageState(await context.storageState());
    const response = await fetch(importUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(storageState),
    });

    if (!response.ok) {
      throw new Error(`Session import failed with HTTP ${response.status}`);
    }
    process.stdout.write('Seeking Alpha session imported successfully.\n');
  } finally {
    await browser.close();
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap failure';
  console.error(message);
  process.exitCode = 1;
});
