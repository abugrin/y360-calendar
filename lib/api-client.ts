/**
 * Centralized API fetch utility with:
 *  - Per-email token bucket rate limiter (default 5 RPS)
 *  - Automatic retry on HTTP 429 with Retry-After header support
 */

const RPS_LIMIT = 5;
const MAX_RETRIES = 3;

// ─── Token Bucket ─────────────────────────────────────────────────────────────

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly tokensPerSecond: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /** Refill tokens proportional to elapsed time. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + (elapsed * this.tokensPerSecond) / 1000,
    );
    this.lastRefill = now;
  }

  /**
   * Acquire one token, waiting if the bucket is empty.
   * Returns the number of milliseconds waited.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Calculate exact wait time until 1 token is available
    const waitMs = Math.ceil(((1 - this.tokens) / this.tokensPerSecond) * 1000);
    await sleep(waitMs);
    this.refill();
    this.tokens -= 1;
  }
}

/** Module-level buckets — one per email, shared across all requests in the process. */
const buckets = new Map<string, TokenBucket>();

function getBucket(email: string): TokenBucket {
  let bucket = buckets.get(email);
  if (!bucket) {
    bucket = new TokenBucket(RPS_LIMIT, RPS_LIMIT);
    buckets.set(email, bucket);
  }
  return bucket;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse the Retry-After header value.
 * Accepts either a delay in seconds (number) or an HTTP-date string.
 * Returns milliseconds to wait.
 */
function parseRetryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = parseFloat(header);
  if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
  const date = new Date(header);
  if (!isNaN(date.getTime())) return Math.max(0, date.getTime() - Date.now());
  return 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Rate-limited fetch with automatic retry on 429.
 *
 * @param email     Used as the rate-limiter key.
 * @param url       Target URL.
 * @param options   Standard RequestInit options.
 * @param retries   Maximum number of retry attempts on 429 (default 3).
 */
export async function apiFetch(
  email: string,
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
): Promise<Response> {
  const bucket = getBucket(email);

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Acquire a rate-limit token before every attempt
    await bucket.acquire();

    const response = await fetch(url, options);

    if (response.status !== 429) {
      return response;
    }

    if (attempt === retries) {
      // Return the 429 response to the caller on the last attempt
      return response;
    }

    // Determine how long to wait before retrying
    const retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After'));
    const backoffMs = retryAfterMs > 0
      ? retryAfterMs
      : Math.pow(2, attempt) * 1000; // 1s, 2s, 4s

    console.warn(
      `[apiFetch] 429 for ${email}, attempt ${attempt + 1}/${retries}. ` +
      `Waiting ${backoffMs}ms before retry.`,
    );

    await sleep(backoffMs);
  }

  // Should be unreachable, but TypeScript needs it
  throw new Error('apiFetch: unexpected state after retry loop');
}
