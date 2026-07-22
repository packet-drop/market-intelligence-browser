const SEEKING_ALPHA_ORIGIN = 'https://seekingalpha.com';

export type InterceptedNavigationState =
  'SESSION_EXPIRED' | 'CHALLENGE_REQUIRED' | 'UPSTREAM_UNAVAILABLE';

export interface ApprovedSeekingAlphaNavigation {
  canonicalPath: string;
  url: string;
  classify(urlValue: string): InterceptedNavigationState | null;
}

const classifyCommon = (urlValue: string): { url?: URL; state?: InterceptedNavigationState } => {
  try {
    const url = new URL(urlValue);
    if (url.origin !== SEEKING_ALPHA_ORIGIN) return { state: 'UPSTREAM_UNAVAILABLE' };
    if (url.pathname === '/account/login' || url.pathname.startsWith('/login')) {
      return { state: 'SESSION_EXPIRED' };
    }
    if (/captcha|challenge|verify/i.test(url.pathname)) {
      return { state: 'CHALLENGE_REQUIRED' };
    }
    return { url };
  } catch {
    return { state: 'UPSTREAM_UNAVAILABLE' };
  }
};

const createNavigation = (
  canonicalPath: string,
  isAllowed: (url: URL) => boolean
): ApprovedSeekingAlphaNavigation => ({
  canonicalPath,
  url: `${SEEKING_ALPHA_ORIGIN}${canonicalPath}`,
  classify(urlValue: string): InterceptedNavigationState | null {
    const classified = classifyCommon(urlValue);
    if (classified.state) return classified.state;
    return classified.url && isAllowed(classified.url) ? null : 'UPSTREAM_UNAVAILABLE';
  },
});

export const sessionCheckNavigation = createNavigation(
  '/account/edit_price_alerts?tab=history',
  (url) =>
    url.pathname === '/account/edit_price_alerts' &&
    url.searchParams.size === 1 &&
    url.searchParams.get('tab') === 'history'
);

export const quantRatingNavigation = (ticker: string): ApprovedSeekingAlphaNavigation => {
  const canonicalPath = `/symbol/${ticker}/ratings/quant-ratings`;
  return createNavigation(
    canonicalPath,
    (url) => url.pathname === canonicalPath && url.search === ''
  );
};
