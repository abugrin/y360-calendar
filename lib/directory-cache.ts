import type { DirectorySearchResponse, DirectoryUser } from './directory-types';

export const DIRECTORY_TTL_MS = 60 * 60 * 1000;
export const DIRECTORY_RETRY_MS = 60 * 1000;
const MAX_STALE_MS = 24 * DIRECTORY_TTL_MS;

/** Access/configuration failures must not serve a previously authorized snapshot. */
export class DirectoryAccessError extends Error {}

export function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim();
}

interface IndexedUser { user: DirectoryUser; search: string }
interface Snapshot { users: IndexedUser[]; loadedAt: number }
type Schedule = (callback: () => void, delay: number) => () => void;

const schedule: Schedule = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  timer.unref();
  return () => clearTimeout(timer);
};

/** A single atomic snapshot and in-flight load, shared by all requests in one process. */
export class DirectoryCache {
  private snapshot?: Snapshot;
  private pending?: Promise<Snapshot>;
  private retryAt = 0;
  private cancelTimer?: () => void;
  private disposed = false;

  constructor(
    private readonly load: () => Promise<DirectoryUser[]>,
    private readonly now: () => number = Date.now,
    private readonly scheduleRefresh: Schedule = schedule,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
  }

  private arm(delay: number): void {
    this.cancelTimer?.();
    if (!this.disposed) {
      this.cancelTimer = this.scheduleRefresh(() => {
        void this.refresh().catch(() => undefined);
      }, delay);
    }
  }

  private refresh(): Promise<Snapshot> {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(this.load).then((users) => {
      const snapshot: Snapshot = {
        users: users.map((user) => ({ user, search: normalizeSearch([
          user.email, user.displayName, user.firstName, user.lastName, user.middleName,
        ].join(' ')) })),
        loadedAt: this.now(),
      };
      this.snapshot = snapshot;
      this.retryAt = 0;
      this.arm(DIRECTORY_TTL_MS);
      return snapshot;
    }).catch((error: unknown) => {
      this.retryAt = this.now() + DIRECTORY_RETRY_MS;
      if (error instanceof DirectoryAccessError) {
        this.snapshot = undefined;
        this.cancelTimer?.();
      }
      if (this.snapshot) this.arm(DIRECTORY_RETRY_MS);
      throw error;
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  async search(query: string): Promise<DirectorySearchResponse> {
    const age = this.snapshot ? this.now() - this.snapshot.loadedAt : Infinity;
    if (age >= DIRECTORY_TTL_MS && this.now() >= this.retryAt) {
      try { await this.refresh(); } catch (error) {
        if (!this.snapshot || this.now() - this.snapshot.loadedAt >= MAX_STALE_MS) throw error;
      }
    }
    const snapshot = this.snapshot;
    if (!snapshot || this.now() - snapshot.loadedAt >= MAX_STALE_MS) {
      throw new Error('Справочник временно недоступен. Попробуйте через минуту или введите email.');
    }
    const normalized = normalizeSearch(query);
    const words = normalized.split(/\s+/);
    const matches = normalized.length < 2 ? [] : snapshot.users.filter(({ search }) =>
      words.every((word) => search.includes(word)));
    return {
      users: matches.slice(0, 20).map(({ user }) => user),
      totalMatches: matches.length,
      total: snapshot.users.length,
      loadedAt: new Date(snapshot.loadedAt).toISOString(),
      stale: this.now() - snapshot.loadedAt >= DIRECTORY_TTL_MS,
    };
  }
}
