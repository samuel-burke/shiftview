// jest-dom's own "vitest" types augment `Assertion<T>`, but Vitest 5 declares
// it as `Assertion<R, T>`, so that augmentation no longer merges and its
// matchers vanish from `expect()`. Vitest 5 wants custom matchers on
// `Matchers<R, T>` instead, so register them there.
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<unknown, R> {}
}
