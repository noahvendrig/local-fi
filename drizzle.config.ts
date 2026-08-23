import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.LOCALFI_DATA_DIR
      ? `${process.env.LOCALFI_DATA_DIR}/library.db`
      : "./data/library.db",
  },
} satisfies Config;
