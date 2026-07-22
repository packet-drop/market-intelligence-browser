import { BrowserContext, chromium } from 'playwright';
import { spawn } from 'child_process';
import { access, mkdtemp, rm } from 'fs/promises';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

const LOGIN_URL = 'https://seekingalpha.com/account/login';
const IMPORT_PATH = '/api/admin/sources/seeking-alpha/session/import';
const CHROME_PATHS = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  process.env.PROGRAMFILES &&
    join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] &&
    join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA &&
    join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
].filter((path): path is string => Boolean(path));

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

const resolveChromePath = async (): Promise<string> => {
  for (const path of CHROME_PATHS) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next platform-specific installation path.
    }
  }
  throw new Error(
    'Google Chrome was not found; set PLAYWRIGHT_CHROME_PATH to the Chrome executable'
  );
};

const reserveLocalPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to reserve a local browser debugging port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const waitForChrome = async (endpoint: string): Promise<void> => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome has not opened its local debugging endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for Google Chrome to start');
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
  const chromePath = await resolveChromePath();
  const profilePath = await mkdtemp(join(tmpdir(), 'seeking-alpha-bootstrap-'));
  const debuggingPort = await reserveLocalPort();
  const debuggingEndpoint = `http://127.0.0.1:${debuggingPort}`;
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${profilePath}`,
      `--remote-debugging-port=${debuggingPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      LOGIN_URL,
    ],
    { stdio: 'ignore' }
  );
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    await waitForChrome(debuggingEndpoint);
    await waitForEnter();

    browser = await chromium.connectOverCDP(debuggingEndpoint);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chrome did not expose a browser context');
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
    await browser?.close();
    chrome.kill();
    await rm(profilePath, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
  }
};

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown bootstrap failure';
  console.error(message);
  process.exitCode = 1;
});
