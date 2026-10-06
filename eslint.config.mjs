import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // CLI / standalone build output — generated, not source.
    ".next-cli-build/**",
    "cli/app/.next-cli-build/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
