import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BackgroundAsset, Project } from '../../shared/types';
import { backgroundFile, parseBackgroundAssets } from './project-backgrounds';

/** Retain only the most recently selected image; every project owns its independent copy. */
export class CanvasBackgroundDefaults {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: () => string) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.catch(() => undefined).then(operation);
    this.pending = next;
    return next;
  }

  private async read(): Promise<BackgroundAsset | undefined> {
    try {
      const manifest = path.join(this.directory(), 'selection.json');
      if ((await fs.stat(manifest)).size > 4096) return;
      const value: unknown = JSON.parse(await fs.readFile(manifest, 'utf8'));
      if (value === null) return;
      const asset = parseBackgroundAssets([value])[0];
      await backgroundFile(this.directory(), asset);
      return asset;
    } catch { /* Missing or corrupt optional defaults must never prevent a new recording. */ }
  }

  remember(project: Project, projectDirectory: string): Promise<void> {
    return this.run(async () => {
      const previous = await this.read();
      const id = project.style.background.startsWith('asset:') ? project.style.background.slice(6) : undefined;
      if (previous?.id === id) return;
      const selected = id ? project.backgrounds?.find(asset => asset.id === id) : undefined;
      if (id && !selected) throw new Error('要记住的背景图片不属于当前工程');
      const next = selected ? { ...selected, src: `background-${selected.id}.png` } : undefined;
      const directory = this.directory();
      await fs.mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `selection-${randomUUID()}.tmp`);
      const imageTemporary = path.join(directory, `image-${randomUUID()}.tmp`);
      let copied = false, committed = false;
      try {
        if (next) {
          await fs.copyFile(await backgroundFile(projectDirectory, next), imageTemporary, fs.constants.COPYFILE_EXCL);
          await fs.rename(imageTemporary, path.join(directory, next.src));
          copied = true;
        }
        await fs.writeFile(temporary, JSON.stringify(next ?? null), { flag: 'wx' });
        await fs.rename(temporary, path.join(directory, 'selection.json'));
        committed = true;
        if (previous) await fs.rm(path.join(directory, previous.src), { force: true });
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
        await fs.rm(imageTemporary, { force: true }).catch(() => {});
        if (copied && !committed && next) await fs.rm(path.join(directory, next.src), { force: true }).catch(() => {});
      }
    });
  }

  apply(project: Project, projectDirectory: string): Promise<void> {
    return this.run(async () => {
      const asset = await this.read();
      if (!asset) return;
      await fs.copyFile(await backgroundFile(this.directory(), asset), path.join(projectDirectory, asset.src), fs.constants.COPYFILE_EXCL);
      project.backgrounds = [...(project.backgrounds ?? []), asset];
      project.style.background = `asset:${asset.id}`;
    });
  }
}
