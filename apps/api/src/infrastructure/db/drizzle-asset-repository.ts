import { desc, eq } from "drizzle-orm";
import { assets, type AssetRow, type Database } from "@dyo/database";
import type { AssetRecord, AssetRepository, AssetUpdate, NewAssetRecord } from "../../domain/asset/types.js";

function toDomain(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    originalFilename: row.originalFilename,
    storageKey: row.storageKey,
    mediaKind: row.mediaKind,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    label: row.label,
    notes: row.notes,
    uploadedAt: row.uploadedAt,
    updatedAt: row.updatedAt
  };
}

export class DrizzleAssetRepository implements AssetRepository {
  constructor(private readonly db: Database) {}

  async create(record: NewAssetRecord, now: Date): Promise<AssetRecord> {
    const [row] = await this.db
      .insert(assets)
      .values({
        id: record.id,
        projectId: record.projectId,
        originalFilename: record.originalFilename,
        storageKey: record.storageKey,
        mediaKind: record.mediaKind,
        mimeType: record.mimeType,
        byteSize: record.byteSize,
        sha256: record.sha256,
        width: record.width,
        height: record.height,
        durationSeconds: record.durationSeconds,
        label: record.label,
        notes: record.notes,
        uploadedAt: now,
        updatedAt: now
      })
      .returning();
    if (!row) {
      throw new Error("insert into assets returned no row");
    }
    return toDomain(row);
  }

  async findById(id: string): Promise<AssetRecord | null> {
    const [row] = await this.db.select().from(assets).where(eq(assets.id, id));
    return row ? toDomain(row) : null;
  }

  async listByProjectId(projectId: string): Promise<AssetRecord[]> {
    const rows = await this.db.select().from(assets).where(eq(assets.projectId, projectId)).orderBy(desc(assets.uploadedAt));
    return rows.map(toDomain);
  }

  async update(id: string, update: AssetUpdate, now: Date): Promise<AssetRecord | null> {
    const patch: Partial<typeof assets.$inferInsert> = { updatedAt: now };
    if (update.label !== undefined) patch.label = update.label;
    if (update.notes !== undefined) patch.notes = update.notes;
    const [row] = await this.db.update(assets).set(patch).where(eq(assets.id, id)).returning();
    return row ? toDomain(row) : null;
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(assets).where(eq(assets.id, id)).returning({ id: assets.id });
    return rows.length > 0;
  }
}
