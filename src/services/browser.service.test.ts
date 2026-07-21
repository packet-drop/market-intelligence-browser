jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';
import { BrowserService } from './browser.service';

describe('BrowserService', () => {
  test('launches and closes Chromium without creating a page', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const version = jest.fn().mockReturnValue('test-version');
    const launch = chromium.launch as jest.Mock;
    launch.mockResolvedValue({ close, version });

    const result = await new BrowserService().runSmokeCheck();

    expect(launch).toHaveBeenCalledWith({ headless: true });
    expect(result).toEqual({
      browser: 'chromium',
      launched: true,
      headless: true,
      version: 'test-version',
    });
    expect(version).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
