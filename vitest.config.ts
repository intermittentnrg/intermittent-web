import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    reporters: process.env.VITEST_JUNIT_OUTPUT ? ["default", "junit"] : ["default"],
    outputFile: process.env.VITEST_JUNIT_OUTPUT
      ? { junit: process.env.VITEST_JUNIT_OUTPUT }
      : undefined,
  },
});
