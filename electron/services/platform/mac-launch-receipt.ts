import { realpathSync } from 'node:fs';

/** Foundation and Node spell /tmp and /var differently. Compare actual filesystem identity. */
export function parseMacLaunchReceipt(output: string, expectedTarget: string): { pid: number; target: string } {
  try {
    const receipt = JSON.parse(output);
    const target = typeof receipt?.target === 'string' ? realpathSync(receipt.target) : undefined;
    if (target !== realpathSync(expectedTarget) || !Number.isSafeInteger(receipt.pid) || receipt.pid < 2)
      throw new Error('Invalid application identity');
    return { pid: receipt.pid, target };
  } catch (cause) { throw new Error('Mac 应用启动回执无效', { cause }); }
}
