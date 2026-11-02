import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const db = new PrismaClient();
try {
  const directory = path.resolve('data/backups');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `before-performance-${Date.now()}.db`).replaceAll('\\', '/');
  await db.$executeRawUnsafe(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  console.log(`Backup created: ${path.basename(file)}`);
} finally { await db.$disconnect(); }
