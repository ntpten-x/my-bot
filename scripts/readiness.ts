import "../src/lib/load-env";
import { productionConfigChecks } from "../src/lib/production-config";

// No database/provider calls: safe to run before credentials or deploy approval exist.
const checks = productionConfigChecks(process.env);
for (const check of checks) console.log(`${check.status} ${check.id}: ${check.message}`);
process.exitCode = checks.every(check => check.status === "PASS") ? 0 : 1;
