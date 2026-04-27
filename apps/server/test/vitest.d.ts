declare module "vitest" {
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const describe: (name: string, fn: () => void) => void;
  export const expect: Expect;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const vi: Vi;

  interface Expect {
    (actual: unknown): Matchers;
    any(expected: unknown): unknown;
  }

  interface Matchers {
    not: Matchers;
    rejects: Matchers;
    resolves: Matchers;
    toBe(expected: unknown): void;
    toBeNull(): void;
    toContain(expected: unknown): void;
    toEqual(expected: unknown): void;
    toHaveBeenCalledTimes(expected: number): void;
    toHaveBeenCalledWith(...expected: unknown[]): void;
    toHaveLength(expected: number): void;
    toMatchObject(expected: unknown): void;
    toThrow(expected?: unknown): void;
  }

  interface Vi {
    fn: <
      T extends (...args: never[]) => unknown = (...args: never[]) => unknown,
    >(
      implementation?: T,
    ) => Mock<T>;
    hoisted: <T>(factory: () => T) => T;
    mock: (path: string, factory: () => unknown) => void;
    restoreAllMocks: () => void;
    spyOn: <T extends object, K extends keyof T>(target: T, method: K) => Mock;
  }

  interface Mock<
    T extends (...args: never[]) => unknown = (...args: never[]) => unknown,
  > {
    (...args: Parameters<T>): ReturnType<T>;
    mock: {
      calls: unknown[][];
    };
    mockClear: () => Mock<T>;
    mockImplementation: (implementation: T) => Mock<T>;
    mockResolvedValue: (value: unknown) => Mock<T>;
    mockResolvedValueOnce: (value: unknown) => Mock<T>;
    mockReturnValue: (value: unknown) => Mock<T>;
  }
}
