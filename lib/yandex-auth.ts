import type { UserToken } from './types';

const OAUTH_URL = 'https://oauth.yandex.ru/token';

/** Refresh token this many milliseconds before actual expiry to avoid edge cases. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  accessToken: string;
  /** Timestamp (ms) after which the token should be refreshed. */
  refreshAt: number;
  /** In-flight request promise — prevents parallel token exchanges for the same email. */
  pending?: Promise<string>;
}

/** Module-level cache: survives across requests within the same Node.js process. */
const tokenCache = new Map<string, CacheEntry>();

/**
 * Returns a valid OAuth access token for the given user email.
 * Cached per email; refreshed automatically when less than 5 minutes remain.
 * Concurrent callers for the same email share a single in-flight request.
 */
export async function getUserToken(userEmail: string): Promise<UserToken> {
  const cached = tokenCache.get(userEmail);

  // Return cached token if still valid
  if (cached && Date.now() < cached.refreshAt && !cached.pending) {
    return { access_token: cached.accessToken, token_type: 'bearer', expires_in: 0 };
  }

  // If a refresh is already in flight for this email, wait for it
  if (cached?.pending) {
    const accessToken = await cached.pending;
    return { access_token: accessToken, token_type: 'bearer', expires_in: 0 };
  }

  // Start a new token exchange and store the promise immediately so concurrent
  // callers can attach to it instead of firing duplicate requests
  const fetchPromise = fetchToken(userEmail);

  tokenCache.set(userEmail, { accessToken: '', refreshAt: 0, pending: fetchPromise });

  try {
    const accessToken = await fetchPromise;
    return { access_token: accessToken, token_type: 'bearer', expires_in: 0 };
  } catch (err) {
    // Clear the failed entry so the next call retries
    tokenCache.delete(userEmail);
    throw err;
  }
}

async function fetchToken(userEmail: string): Promise<string> {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('YANDEX_CLIENT_ID и YANDEX_CLIENT_SECRET должны быть заданы в .env.local');
  }

  const response = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: clientId,
      client_secret: clientSecret,
      subject_token: userEmail,
      subject_token_type: 'urn:yandex:params:oauth:token-type:email',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error_description: response.statusText }));
    throw new Error(
      `Ошибка получения токена (${response.status}): ${error.error_description || error.error || response.statusText}`
    );
  }

  const data: UserToken = await response.json();

  // Cache the token; schedule refresh before actual expiry
  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  tokenCache.set(userEmail, {
    accessToken: data.access_token,
    refreshAt: Date.now() + expiresInMs - REFRESH_BEFORE_MS,
  });

  return data.access_token;
}
