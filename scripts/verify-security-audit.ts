import "../src/lib/load-env";
import { verifySecurityAudit } from "../src/lib/security-audit";
import { prisma } from "../src/lib/prisma";
verifySecurityAudit().then(result => { console.log(JSON.stringify(result)); if (!result.valid) process.exitCode = 1; }).catch(() => { console.error("FAIL audit verification (keys withheld)"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
