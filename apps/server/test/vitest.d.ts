declare module "vitest" {
  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void) => void;
  export const expect: Expect;

  type Expect = (actual: unknown) => Matchers;

  interface Matchers {
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatchObject(expected: unknown): void;
  }
}
