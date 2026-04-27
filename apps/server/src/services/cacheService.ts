interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

export class CacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    return this.store.get(key)?.value as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, {
      value,
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.store.clear();
  }
}

export const cacheService = new CacheService();
