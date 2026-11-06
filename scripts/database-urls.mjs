import { pathToFileURL } from "node:url";

export function databaseUrls(value) {
  const pooled = new URL(value);
  if (!["postgres:", "postgresql:"].includes(pooled.protocol)) throw new Error("Expected a Postgres URL");
  const direct = new URL(pooled);
  if (direct.port === "6543") direct.port = "5432";
  direct.searchParams.delete("pgbouncer");
  pooled.searchParams.set("pgbouncer", "true");
  if (!pooled.searchParams.has("connection_limit")) pooled.searchParams.set("connection_limit", "5");
  return [pooled.toString(), direct.toString()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  try { process.stdout.write(databaseUrls(value).join("\n")); }
  catch { console.error("Invalid Postgres connection string (value hidden)"); process.exitCode = 1; }
}
