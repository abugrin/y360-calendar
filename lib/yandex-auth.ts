import 'server-only';
import { apiFetch, ApiError } from './api-client';
import { isValidEmail } from './validation';
import type { UserToken } from './types';

const OAUTH_URL = 'https://oauth.yandex.ru/token';
const REFRESH_BEFORE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 1_000;

interface CacheEntry {
  token?: UserToken;
  refreshAt: number;
  expiresAt: number;
  pending?: Promise<UserToken>;
}

const tokenCache = new Map<string, CacheEntry>();

function reserveCacheEntry(email: string): CacheEntry {
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (!entry.pending && entry.refreshAt <= now) tokenCache.delete(key);
  }
  if (tokenCache.size >= MAX_CACHE_ENTRIES) {
    const idle = [...tokenCache].find(([, entry]) => !entry.pending);
    if (idle) tokenCache.delete(idle[0]);
    else throw new ApiError('Слишком много одновременных запросов авторизации.', 503);
  }
  const entry: CacheEntry = { refreshAt: 0, expiresAt: 0 };
  tokenCache.set(email, entry);
  return entry;
}

/** Cached per normalized email; simultaneous callers share the same exchange. */
export async function getUserToken(userEmail: string): Promise<UserToken> {
  const email = userEmail.trim().toLowerCase();
  if (!isValidEmail(email)) throw new ApiError('Укажите корректный email.', 400);
  const cached = tokenCache.get(email);
  if (cached?.pending) return cached.pending;
  if (cached?.token && Date.now() < cached.refreshAt) {
    // Refresh insertion order so capacity eviction removes least-recently-used data.
    tokenCache.delete(email);
    tokenCache.set(email, cached);
    return { ...cached.token, expires_in: Math.max(0, Math.floor((cached.expiresAt - Date.now()) / 1000)) };
  }

  const entry = reserveCacheEntry(email);
  const pending = fetchToken(email).then((token) => {
    const lifetime = token.expires_in * 1000;
    entry.token = token;
    entry.expiresAt = Date.now() + lifetime;
    // Short-lived tokens must still be cacheable instead of expiring immediately.
    entry.refreshAt = entry.expiresAt - Math.min(REFRESH_BEFORE_MS, lifetime * 0.1);
    entry.pending = undefined;
    return token;
  }).catch((error: unknown) => {
    tokenCache.delete(email);
    throw error;
  });
  entry.pending = pending;
  return pending;
}

async function fetchToken(userEmail: string): Promise<UserToken> {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ApiError('На сервере не настроен доступ к календарю.', 503);
  }

  const response = await apiFetch(`oauth:${userEmail}`, OAUTH_URL, {
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
    await response.body?.cancel();
    throw new ApiError(`Не удалось получить доступ к календарю (OAuth ${response.status}).`, response.status === 429 ? 429 : 502);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || !('access_token' in data) ||
      typeof data.access_token !== 'string' || !data.access_token ||
      !('expires_in' in data) || typeof data.expires_in !== 'number' ||
      !Number.isFinite(data.expires_in) || data.expires_in <= 0 ||
      !('token_type' in data) || typeof data.token_type !== 'string' ||
      data.token_type.toLowerCase() !== 'bearer') {
    throw new ApiError('OAuth API вернул некорректный ответ.');
  }
  return { access_token: data.access_token, token_type: 'bearer', expires_in: data.expires_in };
}
