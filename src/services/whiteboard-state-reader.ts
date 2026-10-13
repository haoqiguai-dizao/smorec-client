import type { BoardSnapshot } from '../../shared/whiteboard/types';

type State = Omit<BoardSnapshot, 'events'>;
type ReadResult = { snapshot: BoardSnapshot; state: State } | undefined;

/** A snapshot hydrates ink; a newer push remains authoritative for window state. */
export class WhiteboardStateReader {
  private revision = 0;
  private latest?: State;
  private disposed = false;
  private pending?: { session?: string; promise: Promise<ReadResult> };
  constructor(private snapshot: () => Promise<BoardSnapshot>) {}
  observe(state: State): void { this.latest = state; }
  read(): Promise<ReadResult> {
    const session = this.latest?.session;
    if (this.pending && this.pending.session === session) return this.pending.promise;
    const promise = this.hydrate().finally(() => {
      if (this.pending?.promise === promise) this.pending = undefined;
    });
    this.pending = { session, promise };
    return promise;
  }
  private async hydrate(): Promise<ReadResult> {
    const revision = ++this.revision;
    let snapshot: BoardSnapshot;
    try { snapshot = await this.snapshot(); }
    catch (error) { if (this.disposed || revision !== this.revision) return; throw error; }
    if (this.disposed || revision !== this.revision || this.latest && this.latest.session !== snapshot.session) return;
    return { snapshot, state: this.latest ?? snapshot };
  }
  dispose(): void { this.disposed = true; this.revision++; }
}
