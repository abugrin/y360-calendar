import 'server-only';

const RPS_LIMIT = 5;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BUCKETS = 1_000;
const MAX_PENDING_PER_BUCKET = 100;
const IDLE_BUCKET_TTL_MS = 10 * 60_000;

/** Only errors constructed here may be shown to a browser. */
export class ApiError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getSafeErrorMessage(
  error: unknown,
  fallback = 'Не удалось загрузить данные. Попробуйте позже.',
): string {
  return error instanceof ApiError ? error.message : fallback;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
  active: number;
}

const buckets = new Map<string, Bucket>();

function getBucket(key: string): Bucket {
  const now = Date.now();
  for (const [storedKey, bucket] of buckets) {
    if (!bucket.active && now - bucket.updatedAt >= IDLE_BUCKET_TTL_MS) {
      buckets.delete(storedKey);
    }
  }

  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) {
      // Eviction must not reset an active or partially depleted limiter.
      const idle = [...buckets].find(([, value]) => value.active === 0 &&
        value.tokens + Math.max(0, now - value.updatedAt) * RPS_LIMIT / 1000 >= RPS_LIMIT);
      if (idle) buckets.delete(idle[0]);
      else throw new ApiError('Слишком много одновременных запросов. Попробуйте позже.', 503);
    }
    bucket = { tokens: RPS_LIMIT, updatedAt: now, active: 0 };
    buckets.set(key, bucket);
  }
  if (bucket.active >= MAX_PENDING_PER_BUCKET) {
    throw new ApiError('Слишком много одновременных запросов. Попробуйте позже.', 429);
  }
  return bucket;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function acquire(bucket: Bucket, signal: AbortSignal): Promise<void> {
  const now = Date.now();
  bucket.tokens = Math.min(RPS_LIMIT, bucket.tokens + Math.max(0, now - bucket.updatedAt) * RPS_LIMIT / 1000);
  bucket.updatedAt = now;
  // Reserve before awaiting. Negative tokens represent distinct queued slots.
  // Concurrent waiters must not all wake up and spend the same token.
  bucket.tokens -= 1;
  await sleep(Math.max(0, Math.ceil(-bucket.tokens * 1000 / RPS_LIMIT)), signal);
}

export function parseRetryAfterMs(header: string | null, now = Date.now()): number {
  if (!header) return 0;
  const value = header.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

/** A bounded per-identity limiter and deadline shared by queueing and 429 retries. */
export async function apiFetch(
  email: string,
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  const bucket = getBucket(email.trim().toLowerCase());
  bucket.active += 1;
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const retryLimit = Number.isInteger(retries) ? Math.max(0, Math.min(retries, MAX_RETRIES)) : MAX_RETRIES;

  try {
    for (let attempt = 0; ; attempt++) {
      await acquire(bucket, signal);
      signal.throwIfAborted();
      const response = await fetch(url, { ...options, signal });
      if (response.status !== 429 || attempt >= retryLimit) return response;

      const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
      const delay = retryAfterMs || 2 ** attempt * 1000;
      // Do not ignore a long Retry-After, or retain the connection while waiting.
      if (delay >= deadline - Date.now()) return response;
      await response.body?.cancel();
      await sleep(delay, signal);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (signal.aborted) throw new ApiError('Превышено время ожидания ответа API.', 504);
    throw new ApiError('Не удалось связаться с API. Попробуйте позже.', 502);
  } finally {
    bucket.active -= 1;
  }
}
