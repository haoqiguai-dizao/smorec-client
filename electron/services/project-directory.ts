import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LEGACY_PROJECTS_DIRECTORY, PROJECTS_DIRECTORY } from '../../shared/brand';

export interface ProjectDirectoryResult {
  directory: string;
  status: 'current' | 'migrated' | 'legacy';
  reason?: 'destination-exists' | 'rename-failed';
}

async function inspect(directory: string) {
  try { return await fs.lstat(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Run after the single-instance lock, before opening any project or recording. */
export async function initializeProjectDirectory(videos: string,
  rename: typeof fs.rename = fs.rename): Promise<ProjectDirectoryResult> {
  // Resolve the system Videos/Movies parent first (it can live on another drive).
  await fs.mkdir(videos, { recursive: true });
  const parent = await fs.realpath(videos);
  const legacy = path.join(parent, LEGACY_PROJECTS_DIRECTORY);
  const directory = path.join(parent, PROJECTS_DIRECTORY);
  const old = await inspect(legacy);
  const current = await inspect(directory);
  const validate = (stat: Awaited<ReturnType<typeof inspect>>) => {
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new Error('工程根目录不能是文件或链接');
  };
  validate(old);
  if (!old) {
    validate(current);
    return { directory, status: 'current' };
  }
  // Never merge two libraries or overwrite a user-created destination.
  if (current) return { directory: legacy, status: 'legacy', reason: 'destination-exists' };
  try {
    // Both fixed child paths stay within the resolved system media directory.
    // A same-parent rename retains every file, including unfinished recordings.
    await rename(legacy, directory);
    return { directory, status: 'migrated' };
  } catch {
    // A lock or permission error must not turn the existing library into an empty one.
    return { directory: legacy, status: 'legacy', reason: 'rename-failed' };
  }
}
