import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, makeBackup, validateBackup } from "../../src/lib/backup-format";

const emptyTables = () => Object.fromEntries(BACKUP_TABLES.map(name => [name, []]));
describe("backup preflight", () => {
  it("accepts complete v2 files, rejects missing tables, corruption and unknown versions", () => {
    const data = makeBackup(emptyTables());
    expect(Object.keys(validateBackup(data))).toHaveLength(BACKUP_TABLES.length);
    const missing = structuredClone(data); delete missing.tables.ExtensionDevice;
    expect(() => validateBackup(missing)).toThrow(/Missing backup table/);
    const corrupt = structuredClone(data); corrupt.tables.Owner.push({ id: "tampered" });
    expect(() => validateBackup(corrupt)).toThrow(/integrity/);
    expect(() => validateBackup({ ...data, version: 99 })).toThrow(/format/);
  });
  it("requires explicit legacy consent, preserving old backup support", () => {
    const old = { format: "mybot-backup", version: 1, tables: { Category: [] } };
    expect(() => validateBackup(old)).toThrow(/allow-legacy/);
    expect(validateBackup(old, true).ExtensionDevice).toEqual([]);
  });
  it("requires consent for v2 backups predating Auto Comment without weakening older-table checks", () => {
    const partial = makeBackup(emptyTables());
    delete partial.tables.AutoCommentJob; delete partial.manifest.AutoCommentJob;
    expect(() => validateBackup(partial, true)).toThrow(/Missing backup table/);
    const old = makeBackup(emptyTables());
    for (const name of BACKUP_TABLES.filter(table => table.startsWith("AutoComment"))) { delete old.tables[name]; delete old.manifest[name]; }
    expect(() => validateBackup(old)).toThrow(/Missing backup table/);
    expect(validateBackup(old, true).AutoCommentJob).toEqual([]);
    delete old.tables.ExtensionDevice;
    expect(() => validateBackup(old, true)).toThrow(/Missing backup table/);
  });
  it("rejects malformed rows, duplicate ids and invalid category trees before deletion", () => {
    const tables = emptyTables();
    tables.Category = [{ id: "child", name: "child", slug: "child", parentId: "missing" }] as never[];
    expect(() => validateBackup(makeBackup(tables))).toThrow(/Category tree/);
    tables.Category = [{ id: "a", name: "a", slug: "a" }, { id: "a", name: "b", slug: "b" }] as never[];
    expect(() => validateBackup(makeBackup(tables))).toThrow(/Duplicate primary/);
    tables.Category = [{ id: "a", slug: "a" }] as never[];
    expect(() => validateBackup(makeBackup(tables))).toThrow(/Missing required/);
  });
});
