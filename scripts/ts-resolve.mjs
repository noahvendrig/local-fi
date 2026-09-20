/**
 * Lets `node scripts/vibe-eval.mts` load the vibe scoring core directly.
 *
 * Node runs .ts files natively (type-stripping) but resolves imports by ESM rules, which require a
 * file extension. The app's source is written for the bundler, where imports are extensionless --
 * so rather than making lib/llm/vibe*.ts unlike every other file in the repo, this hook appends the
 * extension at resolve time. Preload it with `node --import ./scripts/ts-resolve.mjs`.
 *
 * Only affects relative specifiers that don't already resolve; bare package names (better-sqlite3)
 * and anything with an extension fall through to Node's normal resolution untouched.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const CANDIDATE_SUFFIXES = [".ts", ".mts", "/index.ts", ".js"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const base = dirname(fileURLToPath(context.parentURL));
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = resolvePath(base, specifier + suffix);
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
