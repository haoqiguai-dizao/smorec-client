/** Per-project serialization; a delete locks new work immediately and drains accepted work first. */
export class ProjectOperations {
  private tails = new Map<string, Promise<void>>();
  private deleting = new Set<string>();
  private deleted = new Set<string>();
  unavailable(id: string): boolean { return this.deleting.has(id) || this.deleted.has(id); }
  assertAvailable(id: string): void {
    if (this.unavailable(id)) throw new Error('工程已删除或正在移入回收站');
  }
  run<T>(id: string, action: () => Promise<T>): Promise<T> {
    this.assertAvailable(id);
    const result = (this.tails.get(id) ?? Promise.resolve()).then(action);
    const settled = result.then(() => {}, () => {});
    this.tails.set(id, settled);
    void settled.then(() => { if (this.tails.get(id) === settled) this.tails.delete(id); });
    return result;
  }
  async remove<T>(id: string, action: () => Promise<T>): Promise<T> {
    this.assertAvailable(id); this.deleting.add(id);
    try {
      await this.tails.get(id);
      const result = await action();
      this.deleted.add(id);
      return result;
    } finally { this.deleting.delete(id); }
  }
}
