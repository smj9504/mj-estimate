import { defineConfig } from 'vitest/config';

/**
 * Vitest setup for the sketch geometry layer.
 *
 * Deliberately narrow for now. Two constraints shape this config:
 *
 *  1. `include` is scoped to the sketch utils rather than all of `src`. The
 *     project still runs CRA's Jest via `craco test`, and
 *     `src/pages/InsuranceExtraction.test.tsx` is written against that runner.
 *     Widening this glob would make vitest try to own that file too.
 *
 *  2. `globals` stays off. `@types/jest` is a dependency, so its ambient
 *     `describe` / `it` / `expect` declarations are already in scope project
 *     wide; enabling vitest globals would collide with them. Test files import
 *     what they need from 'vitest' explicitly instead, which keeps both
 *     runners able to coexist without touching tsconfig.
 *
 * These tests cover pure functions only — no DOM, no Konva — so the default
 * node environment is correct and fast.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/components/**/sketch/**/*.test.ts'],
  },
});
