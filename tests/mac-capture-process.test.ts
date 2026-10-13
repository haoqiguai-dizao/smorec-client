import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MacCaptureProcess } from '../electron/services/platform/mac-capture-process';

async function fixture(t: TestContext, invalid = false, deferred = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-launch-order-')));
  const target = path.join(root, 'Capture.app');
  await fs.mkdir(path.join(target, 'Contents/MacOS'), { recursive: true });
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ main: 'launcher.cjs' }));
  await fs.writeFile(path.join(target, 'rpc.cjs'), `
    const net = require('node:net');
    process.once('exit', () => require('node:fs').writeFileSync(__dirname + '/exited', 'closed')); 
    const socket = net.connect(process.argv[2]);
    process.once('SIGTERM', () => { socket.destroy(); process.exit(0); });
    socket.once('connect', () => require('node:fs').writeFileSync(__dirname + '/connected', 'ready'));
    socket.on('data', () => socket.write('reply\\n'));
    socket.on('end', () => socket.end());
    socket.on('close', () => process.exit(0));
  `);
  await fs.writeFile(path.join(target, 'launcher.cjs'), `
    const { spawn } = require('node:child_process');
    const target = __dirname;
    const args = JSON.parse(process.argv[2]);
    const child = spawn(process.execPath, [target + '/rpc.cjs', args[0].slice('--protocol-socket='.length)], { stdio: 'ignore' });
    require('node:fs').writeFileSync(target + '/pid', String(child.pid));
    child.unref();
    let announced = false;
    child.once('exit', () => { if (!announced && !${deferred}) { console.error('helper exited before launch receipt'); process.exit(1); } });
    const announce = () => { announced = true; process.stdout.write(JSON.stringify({ pid: child.pid, target: ${invalid ? 'target + "/foreign"' : 'target'} })); process.exit(0); };
    if (${deferred}) setInterval(() => { if (require('node:fs').existsSync(target + '/allow-receipt')) announce(); }, 10);
    else setTimeout(announce, 200);
  `);
  const proc = new MacCaptureProcess(path.join(target, 'Contents/MacOS/Capture'), process.execPath, process.pid);
  const errors: Error[] = []; proc.on('error', error => errors.push(error));
  const closed = new Promise<number>(resolve => proc.once('close', resolve));
  t.after(async () => {
    await fs.writeFile(path.join(target, 'allow-receipt'), 'allowed');
    proc.kill(); await closed;
    const deadline = Date.now() + 3000;
    while (!await fs.access(path.join(target, 'exited')).then(() => true, () => false)) {
      assert.ok(Date.now() < deadline, 'fixture helper must exit before removing its directory');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (deferred) {
      const receiptDeadline = Date.now() + 3000;
      while (!proc.pid) {
        assert.ok(Date.now() < receiptDeadline, 'delayed launcher must deliver its receipt before removing the fixture');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  return { proc, errors, closed, target };
}

test('one-shot RPC waits for a valid launch receipt before exposing a reply and ending the helper', async t => {
  const { proc, errors, closed } = await fixture(t);
  const reply = new Promise<{ bytes: string; pid?: number }>(resolve => proc.stdout.once('data', bytes => { resolve({ bytes: String(bytes), pid: proc.pid }); proc.stdin.end(); }));
  proc.stdin.write('capabilities\n');
  const response = await reply; assert.ok(response.pid); assert.equal(response.bytes, 'reply\n');
  assert.equal(await closed, 0); assert.deepEqual(errors, []);
});

test('invalid launch receipt never exposes a connected helper response', async t => {
  const { proc, errors, closed } = await fixture(t, true);
  let replies = 0; proc.stdout.on('data', () => replies++); proc.stdin.write('capabilities\n');
  assert.equal(await closed, 1); assert.equal(replies, 0);
  assert.equal(errors.length, 1); assert.match(errors[0].message, /启动回执无效/);
});

test('cancelling before the delayed receipt closes the process and terminates the late helper', async t => {
  const { proc, errors, closed, target } = await fixture(t, false, true);
  const connectedDeadline = Date.now() + 5000;
  while (!await fs.access(path.join(target, 'connected')).then(() => true, () => false)) {
    assert.ok(Date.now() < connectedDeadline, 'fixture socket must connect');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(proc.pid, undefined); proc.kill();
  await fs.writeFile(path.join(target, 'allow-receipt'), 'allowed');
  assert.equal(await closed, 0);
  const deadline = Date.now() + 3000;
  while (!await fs.access(path.join(target, 'exited')).then(() => true, () => false)) {
    assert.ok(Date.now() < deadline, 'cancelled helper must exit');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(errors, []);
});
