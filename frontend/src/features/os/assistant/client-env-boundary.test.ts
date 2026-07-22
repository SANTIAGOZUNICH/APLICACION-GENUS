import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_MODULES = [
  "src/features/os/assistant/creamy-chat.tsx",
  "src/features/os/assistant/build-local-snapshot.ts",
];

describe("Creamy client env boundary", () => {
  it("no referencia claves OpenAI ni SDK server en módulos cliente", () => {
    for (const relativePath of CLIENT_MODULES) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");
      expect(source).not.toContain("OPENAI_API_KEY");
      expect(source).not.toContain("CREAMY_OPENAI_API_KEY");
      expect(source).not.toContain("GEMINI_API_KEY");
      expect(source).not.toContain("@ai-sdk/openai");
      expect(source).not.toContain("@ai-sdk/google");
      expect(source).not.toContain("createOpenAI");
      expect(source).not.toContain("createGoogleGenerativeAI");
    }
  });
});
