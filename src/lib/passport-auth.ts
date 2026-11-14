import { Passport } from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Owner } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Passport verifies credentials; the existing database-backed sessions work in
// Next.js Route Handlers without adding Express or an in-memory session store.
const passport = new Passport();
const dummyHash = bcrypt.hashSync("synthetic-timing-only-not-an-account", 12);
passport.use(new LocalStrategy((username, password, done) => {
  void (async () => {
    const owner = await prisma.owner.findUnique({ where: { username } });
    const valid = await bcrypt.compare(password, owner?.passwordHash ?? dummyHash);
    done(null, owner && valid ? owner : false);
  })().catch(done);
}));

export function authenticateOwner(username: string, password: string): Promise<Owner | null> {
  return new Promise((resolve, reject) => {
    // A custom callback with session:false deliberately bypasses Express login.
    // Never expose the resulting Owner (which contains passwordHash) to clients.
    const middleware = passport.authenticate("local", { session: false }, (error: unknown, user: Owner | false) => {
      if (error) reject(error); else resolve(user || null);
    });
    middleware(
      { body: { username, password } } as Parameters<typeof middleware>[0],
      {} as Parameters<typeof middleware>[1],
      (error?: unknown) => reject(error ?? new Error("Authentication did not complete")),
    );
  });
}
