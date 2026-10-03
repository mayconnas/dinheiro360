import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": fromRoot("./src"),
      // "server-only" lança erro fora de um React Server Component;
      // nos testes ele vira um módulo vazio.
      "server-only": fromRoot("./test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Dono das contas nos testes: o mesmo CPF fictício de test/fixtures.ts
    // (FAKE_OWNER_CPF). Em produção vem da env OWNER_DOCUMENTS.
    env: { OWNER_DOCUMENTS: "123.456.789-09" },
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**"],
      exclude: ["src/lib/**/*.test.ts"],
      reporter: ["text", "html"],
    },
  },
});
