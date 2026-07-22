import { Page } from 'playwright';
import { SeekingAlphaOperationError } from './seeking-alpha-operation-error';
import {
  extractQuantRating,
  normalizeTicker,
  SeekingAlphaQuantService,
} from './seeking-alpha-quant.service';
import { SeekingAlphaSessionService } from './seeking-alpha-session.service';

const pageWithStates = (
  ratingStates: string[][],
  priceStates: string[][],
  containerError?: Error,
  bodyText = ''
): Page => {
  let ratingIndex = 0;
  let priceIndex = 0;
  const ratings = {
    allInnerTexts: jest.fn(async () => {
      const value = ratingStates[Math.min(ratingIndex, ratingStates.length - 1)] ?? [];
      ratingIndex += 1;
      return value;
    }),
  };
  const container = {
    isVisible: containerError
      ? jest.fn().mockResolvedValue(false)
      : jest.fn().mockResolvedValue(true),
    locator: jest.fn().mockReturnValue(ratings),
  };
  const price = {
    allInnerTexts: jest.fn(async () => {
      const value = priceStates[Math.min(priceIndex, priceStates.length - 1)] ?? [];
      priceIndex += 1;
      return value;
    }),
  };

  return {
    title: jest.fn().mockResolvedValue('AAPL Quant Rating'),
    locator: jest.fn((selector: string) => {
      if (selector === 'body') {
        return { innerText: jest.fn().mockResolvedValue(bodyText) };
      }
      return selector.includes('card-container-quant-rating') ? container : price;
    }),
  } as unknown as Page;
};

describe('Seeking Alpha Quant extraction', () => {
  test.each([
    [' aapl ', 'AAPL'],
    ['brk.b', 'BRK.B'],
    ['ABC-1', 'ABC-1'],
    ['', null],
    ['../account/login', null],
    ['AAPL?source=email', null],
    ['A'.repeat(16), null],
  ])('normalizes ticker %p to %p', (input, expected) => {
    expect(normalizeTicker(input)).toBe(expected);
  });

  test('waits through placeholders and returns hydrated values', async () => {
    const page = pageWithStates(
      [['Quant Rating\n--\n--'], ['Quant Rating\nHOLD\n3.42 / 5']],
      [['--'], ['$1,234.56']]
    );

    await expect(extractQuantRating(page, 500)).resolves.toEqual({
      rating: 'HOLD',
      score: 3.42,
      observedPrice: 1234.56,
    });
  });

  test('rejects an explicit not-covered state', async () => {
    const page = pageWithStates([['Not Covered']], [['$12.34']]);

    await expect(extractQuantRating(page, 10)).rejects.toMatchObject({
      operationCode: 'UNSUPPORTED_STATE',
    });
  });

  test('reports a hydration timeout when selectors remain placeholders', async () => {
    const page = pageWithStates([['Quant Rating\n--\n--']], [['Price\n--']]);

    await expect(extractQuantRating(page, 1)).rejects.toMatchObject({
      operationCode: 'HYDRATION_TIMEOUT',
    });
  });

  test('reports incomplete partial hydration as a timeout', async () => {
    const page = pageWithStates([['Quant Rating\n--\n--']], [['$123.45']]);

    await expect(extractQuantRating(page, 1)).rejects.toMatchObject({
      operationCode: 'HYDRATION_TIMEOUT',
    });
  });

  test('reports selector drift when the Quant container is absent', async () => {
    const page = pageWithStates([], [], new Error('locator timeout with sensitive URL'));

    await expect(extractQuantRating(page, 1)).rejects.toEqual(
      new SeekingAlphaOperationError('SELECTOR_DRIFT')
    );
  });

  test('recognizes a delayed in-page challenge after the Quant container times out', async () => {
    const page = pageWithStates(
      [],
      [],
      new Error('locator timeout'),
      'PRESS & HOLD\nPlease enable JavaScript and cookies.'
    );

    await expect(extractQuantRating(page, 1)).rejects.toMatchObject({
      operationCode: 'CHALLENGE_REQUIRED',
    });
  });

  test('rejects an out-of-range hydrated score as selector drift', async () => {
    const page = pageWithStates([['HOLD\n9.9']], [['$42.00']]);

    await expect(extractQuantRating(page, 1)).rejects.toMatchObject({
      operationCode: 'SELECTOR_DRIFT',
    });
  });

  test('rejects an unknown hydrated rating vocabulary as selector drift', async () => {
    const page = pageWithStates([['MYSTERY\n3.2']], [['$42.00']]);

    await expect(extractQuantRating(page, 1)).rejects.toMatchObject({
      operationCode: 'SELECTOR_DRIFT',
    });
  });

  test('constructs the canonical path internally and returns normalized output', async () => {
    const page = pageWithStates([['STRONG BUY\n4.91']], [['$99.50']]);
    const runAuthenticatedOperation = jest.fn(async (navigation, operation) => {
      expect(navigation.url).toBe('https://seekingalpha.com/symbol/AAPL/ratings/quant-ratings');
      return operation(page);
    });
    const service = new SeekingAlphaQuantService({
      runAuthenticatedOperation,
    } as unknown as SeekingAlphaSessionService);

    await expect(service.lookup('AAPL')).resolves.toEqual(
      expect.objectContaining({
        ticker: 'AAPL',
        rating: 'STRONG_BUY',
        score: 4.91,
        observedPrice: 99.5,
        canonicalPath: '/symbol/AAPL/ratings/quant-ratings',
        observedAt: expect.any(String),
      })
    );
  });
});
