import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// The Prisma CLI (migrate, studio) uses Neon's direct (non-pooled) connection.
// The app itself connects through the pooled DATABASE_URL via @prisma/adapter-neon.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
