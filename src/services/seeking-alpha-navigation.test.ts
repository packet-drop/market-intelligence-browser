import { quantRatingNavigation, sessionCheckNavigation } from './seeking-alpha-navigation';

describe('Seeking Alpha navigation policy', () => {
  test('allows only the exact server-owned Quant Rating destination', () => {
    const navigation = quantRatingNavigation('BRK.B');

    expect(navigation.canonicalPath).toBe('/symbol/BRK.B/ratings/quant-ratings');
    expect(navigation.classify(navigation.url)).toBeNull();
    expect(navigation.classify(`${navigation.url}?source=email`)).toBe('UPSTREAM_UNAVAILABLE');
    expect(navigation.classify('https://example.com/symbol/BRK.B/ratings/quant-ratings')).toBe(
      'UPSTREAM_UNAVAILABLE'
    );
  });

  test('classifies login and challenge redirects explicitly', () => {
    expect(sessionCheckNavigation.classify('https://seekingalpha.com/account/login')).toBe(
      'SESSION_EXPIRED'
    );
    expect(sessionCheckNavigation.classify('https://seekingalpha.com/account/challenge')).toBe(
      'CHALLENGE_REQUIRED'
    );
  });
});
