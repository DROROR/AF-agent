import type { AssetRecord, AssetRepository, AssetUpdate, NewAssetRecord } from "../../../domain/asset/types.js";

/** In-memory fake used only by unit tests - never imported from production code. */
export class InMemoryAssetRepository implements AssetRepository {
  private readonly rows = new Map<string, AssetRecord>();

  async create(record: NewAssetRecord, now: Date): Promise<AssetRecord> {
    const row: AssetRecord = { ...record, uploadedAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<AssetRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async listByProjectId(projectId: string): Promise<AssetRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.projectId === projectId)
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  }

  async update(id: string, update: AssetUpdate, now: Date): Promise<AssetRecord | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: AssetRecord = {
      ...existing,
      ...(update.label !== undefined ? { label: update.label } : {}),
      ...(update.notes !== undefined ? { notes: update.notes } : {}),
      updatedAt: now
    };
    this.rows.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}
