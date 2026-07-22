import { Page } from 'playwright';
import env from '../config/env';
import logger from '../config/logger';
import { SeekingAlphaQuantRating, SeekingAlphaQuantRatingResult } from '../types/api.types';
import { quantRatingNavigation } from './seeking-alpha-navigation';
import { SeekingAlphaOperationError } from './seeking-alpha-operation-error';
import {
  pageRequiresChallenge,
  SeekingAlphaSessionService,
  seekingAlphaSessionService,
} from './seeking-alpha-session.service';

const QUANT_CONTAINER = '[data-test-id="card-container-quant-rating"]';
const CARD_RATING = '[data-test-id="card-rating"]';
const SYMBOL_PRICE = '[data-test-id="symbol-price"]';
const POLL_INTERVAL_MS = 100;
const MAX_DIAGNOSTIC_TEST_IDS = 24;
const DIAGNOSTIC_SELECTORS = {
  quantContainer: QUANT_CONTAINER,
  cardRating: CARD_RATING,
  symbolPrice: SYMBOL_PRICE,
  quantTestId: '[data-test-id*="quant" i], [data-testid*="quant" i]',
  ratingTestId: '[data-test-id*="rating" i], [data-testid*="rating" i]',
  scoreTestId: '[data-test-id*="score" i], [data-testid*="score" i]',
  priceTestId: '[data-test-id*="price" i], [data-testid*="price" i]',
} as const;
const RATING_BY_TEXT: Record<string, SeekingAlphaQuantRating> = {
  'STRONG SELL': 'STRONG_SELL',
  SELL: 'SELL',
  HOLD: 'HOLD',
  BUY: 'BUY',
  'STRONG BUY': 'STRONG_BUY',
};

type ParsedQuantValues = Pick<SeekingAlphaQuantRatingResult, 'rating' | 'score' | 'observedPrice'>;

type DiagnosticStage = 'container_wait' | 'hydration';

const logSelectorDiagnostics = async (page: Page, stage: DiagnosticStage): Promise<void> => {
  const selectorCounts = Object.fromEntries(
    await Promise.all(
      Object.entries(DIAGNOSTIC_SELECTORS).map(async ([name, selector]) => {
        try {
          return [name, await page.locator(selector).count()] as const;
        } catch {
          return [name, -1] as const;
        }
      })
    )
  );

  let semanticTestIds: Record<string, number> = {};
  try {
    semanticTestIds = await page
      .locator('[data-test-id], [data-testid]')
      .evaluateAll((elements, limit) => {
        const counts: Record<string, number> = {};
        for (const element of elements) {
          const testId =
            element.getAttribute('data-test-id') ?? element.getAttribute('data-testid');
          if (
            testId &&
            /(?:quant|rating|score|price)/i.test(testId) &&
            /^(?=.{1,80}$)[a-z0-9][a-z0-9_-]*$/i.test(testId)
          ) {
            counts[testId] = (counts[testId] ?? 0) + 1;
          }
        }
        return Object.fromEntries(
          Object.entries(counts)
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, limit)
        );
      }, MAX_DIAGNOSTIC_TEST_IDS);
  } catch {
    // Diagnostics must never replace the bounded operation error.
  }

  logger.warn({
    message: 'Seeking Alpha Quant selector diagnostics',
    stage,
    selectorCounts,
    semanticTestIds,
  });
};

export const normalizeTicker = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const ticker = value.trim().toUpperCase();
  return /^(?=.{1,15}$)[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(ticker) ? ticker : null;
};

const lines = (values: string[]): string[] =>
  values.flatMap((value) => value.split(/\r?\n/)).map((value) => value.trim());

const isPlaceholderOrLabel = (value: string): boolean =>
  /^(?:\s*|[-—]+|\.\.\.|LOADING|QUANT RATING|RATING|SCORE|PRICE)$/i.test(value);

const hasUnexpectedHydratedValue = (ratingTexts: string[], priceTexts: string[]): boolean => {
  const ratingLines = lines(ratingTexts).filter((value) => !isPlaceholderOrLabel(value));
  const ratingMatches = ratingLines.filter((value) => RATING_BY_TEXT[value.toUpperCase()]);
  const scoreMatches = ratingLines.filter((value) => {
    const match = value.match(/^([0-9](?:\.[0-9]+)?)(?:\s*\/\s*5)?$/);
    const score = match ? Number(match[1]) : NaN;
    return Number.isFinite(score) && score >= 1 && score <= 5;
  });
  const recognizedRatings = new Set(
    ratingMatches.map((value) => RATING_BY_TEXT[value.toUpperCase()])
  );
  const recognizedScores = new Set(scoreMatches.map((value) => Number.parseFloat(value)));
  const unexpectedRatingLine = ratingLines.some(
    (value) => !ratingMatches.includes(value) && !scoreMatches.includes(value)
  );

  const meaningfulPriceLines = lines(priceTexts).filter((value) => !isPlaceholderOrLabel(value));
  const hasValidPrice = meaningfulPriceLines.some((value) => {
    const match = value.match(/^\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
    return Boolean(match && Number(match[1].replace(/,/g, '')) > 0);
  });

  return (
    unexpectedRatingLine ||
    recognizedRatings.size > 1 ||
    recognizedScores.size > 1 ||
    (meaningfulPriceLines.length > 0 && !hasValidPrice)
  );
};

const parseHydratedValues = (
  ratingTexts: string[],
  priceTexts: string[]
): ParsedQuantValues | null => {
  const ratingLines = lines(ratingTexts).filter(Boolean);
  const priceLines = lines(priceTexts).filter(Boolean);
  const unsupported = [...ratingLines, ...priceLines].some((value) =>
    /^(?:N\/?A|NR|NOT (?:COVERED|RATED)|NO RATING)$/i.test(value)
  );
  if (unsupported) throw new SeekingAlphaOperationError('UNSUPPORTED_STATE');

  const ratingMatches = ratingLines
    .map((value) => RATING_BY_TEXT[value.toUpperCase()])
    .filter((value): value is SeekingAlphaQuantRating => Boolean(value));
  const ratings = [...new Set(ratingMatches)];

  const scoreMatches = ratingLines
    .map((value) => value.match(/^([0-9](?:\.[0-9]+)?)(?:\s*\/\s*5)?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .filter((score) => Number.isFinite(score) && score >= 1 && score <= 5);
  const scores = [...new Set(scoreMatches)];

  const priceMatch = priceLines
    .map((value) => value.match(/^\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/))
    .find((match): match is RegExpMatchArray => Boolean(match));
  const observedPrice = priceMatch ? Number(priceMatch[1].replace(/,/g, '')) : NaN;

  if (ratings.length === 1 && scores.length === 1 && observedPrice > 0) {
    return { rating: ratings[0], score: scores[0], observedPrice };
  }
  return null;
};

export const extractQuantRating = async (
  page: Page,
  timeoutMs: number = env.SEEKING_ALPHA_NAVIGATION_TIMEOUT_MS
): Promise<ParsedQuantValues> => {
  const container = page.locator(QUANT_CONTAINER);
  const containerDeadline = Date.now() + timeoutMs;
  let containerVisible = false;
  while (Date.now() <= containerDeadline) {
    try {
      containerVisible = await container.isVisible();
    } catch {
      containerVisible = false;
    }
    if (containerVisible) break;
    if (await pageRequiresChallenge(page)) {
      throw new SeekingAlphaOperationError('CHALLENGE_REQUIRED');
    }
    if (Date.now() < containerDeadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
  if (!containerVisible) {
    await logSelectorDiagnostics(page, 'container_wait');
    throw new SeekingAlphaOperationError('SELECTOR_DRIFT');
  }

  const deadline = Date.now() + timeoutMs;
  let sawRatingElements = false;
  let sawPriceElement = false;
  let sawUnexpectedValue = false;

  while (Date.now() <= deadline) {
    const ratingTexts = await container.locator(CARD_RATING).allInnerTexts();
    const priceTexts = await page.locator(SYMBOL_PRICE).allInnerTexts();
    sawRatingElements ||= ratingTexts.length > 0;
    sawPriceElement ||= priceTexts.length > 0;
    sawUnexpectedValue ||= hasUnexpectedHydratedValue(ratingTexts, priceTexts);

    const parsed = parseHydratedValues(ratingTexts, priceTexts);
    if (parsed) return parsed;
    if (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  if (!sawRatingElements || !sawPriceElement || sawUnexpectedValue) {
    if (await pageRequiresChallenge(page)) {
      throw new SeekingAlphaOperationError('CHALLENGE_REQUIRED');
    }
    await logSelectorDiagnostics(page, 'hydration');
    throw new SeekingAlphaOperationError('SELECTOR_DRIFT');
  }
  throw new SeekingAlphaOperationError('HYDRATION_TIMEOUT');
};

export class SeekingAlphaQuantService {
  constructor(private readonly sessionService: SeekingAlphaSessionService) {}

  async lookup(ticker: string): Promise<SeekingAlphaQuantRatingResult> {
    const navigation = quantRatingNavigation(ticker);
    return this.sessionService.runAuthenticatedOperation(navigation, async (page) => {
      const values = await extractQuantRating(page);
      return {
        ticker,
        ...values,
        canonicalPath: navigation.canonicalPath,
        observedAt: new Date().toISOString(),
      };
    });
  }
}

export const seekingAlphaQuantService = new SeekingAlphaQuantService(seekingAlphaSessionService);
