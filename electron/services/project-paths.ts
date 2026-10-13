import { promises as fs } from 'node:fs';
import path from 'node:path';
import { projectId } from './validation';

export const managedProjectId = (value: unknown): string => projectId(value).toLowerCase();
const samePath = (a: string, b: string): boolean => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

export async function managedProjectRoot(root: string): Promise<string> {
  const absolute = path.resolve(root), stat = await fs.lstat(absolute), actual = await fs.realpath(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(actual, absolute)) throw new Error('工程根目录不能是链接或重定向目录');
  return actual;
}

/** Only one UUID directory directly under the real managed root may be modified. */
export async function managedProjectDirectory(root: string, value: unknown): Promise<string> {
  const id = managedProjectId(value), actualRoot = await managedProjectRoot(root);
  const directory = path.join(actualRoot, id), stat = await fs.lstat(directory), actual = await fs.realpath(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(actual, directory) || !samePath(path.dirname(actual), actualRoot)) {
    throw new Error('只能管理工程目录内的真实工程，不能操作链接');
  }
  return actual;
}

/** Refuse linked descendants instead of relying on shell traversal behavior. */
export async function assertNoProjectLinks(directory: string): Promise<void> {
  const remaining = [directory]; let count = 0;
  while (remaining.length) {
    for (const item of await fs.readdir(remaining.pop()!, { withFileTypes: true })) {
      if (++count > 10000) throw new Error('工程目录包含过多文件，无法安全移入回收站');
      const file = path.join(item.parentPath, item.name), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw new Error('工程包含链接，不能自动移入回收站');
      if (stat.isDirectory()) remaining.push(file);
    }
  }
}
