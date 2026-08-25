import type { en } from "./en";

/**
 * Widens `en`'s literal string/function types into a shape any locale's
 * dictionary can satisfy: string leaves become plain `string` (so he.ts
 * isn't forced to repeat English literal values), function leaves keep
 * their real parameter/return types, and nested objects recurse. Kept in
 * its own module (rather than index.ts) so en.ts/he.ts/index.ts never form
 * an import cycle - he.ts needs this type but must not import from index.ts,
 * which itself imports the `he` value.
 */
type Widen<T> = T extends (...args: infer Args) => infer Return
  ? (...args: Args) => Return
  : T extends string
    ? string
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Dictionary = Widen<typeof en>;
