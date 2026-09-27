import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], {
  stdio: "inherit",
  env: { ...process.env, CLOUDBASE_BUILD: "1", NEXT_TELEMETRY_DISABLED: "1" },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(".next/standalone/server.js")) throw new Error("Missing standalone server.js");
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
