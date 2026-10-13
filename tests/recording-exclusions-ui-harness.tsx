import './floating-launcher-ui-harness';

const calls: string[][] = [];
let applied: string[] = [], pending: (() => void) | undefined, held = false, failed = false;
window.live!.applications = async () => [
  { id: 'C:\\PublicFixtures\\Helper.exe', name: '演示助手', executable: 'Helper.exe' },
  { id: 'C:\\PublicFixtures\\Editor.exe', name: '演示软件', executable: 'Editor.exe' },
];
window.recorder!.setExcludedApplications = async applications => {
  calls.push([...applications]);
  if (held) await new Promise<void>(resolve => { pending = resolve; });
  if (failed) throw new Error('排除应用更新失败，已恢复原来的选择');
  applied = [...applications];
};
Object.assign(window, { recordingExclusionsUI: {
  hold: () => { held = true; }, release: () => { held = false; pending?.(); pending = undefined; },
  fail: (value: boolean) => { failed = value; }, state: () => ({ calls, applied }),
} });
