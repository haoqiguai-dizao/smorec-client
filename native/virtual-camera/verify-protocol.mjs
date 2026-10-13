import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

const executable = fileURLToPath(new URL('./bin/x64/XiaoLu.CameraBridge.exe', import.meta.url))
function launch(args) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const messages = []
  let carry = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
    carry += chunk
    const lines = carry.split('\n'); carry = lines.pop()
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line))
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  const done = once(child, 'close').then(([code]) => ({ code, messages, stdout, stderr }))
  return { child, messages, done }
}
async function command(args) {
  const task = launch(args)
  task.child.stdin.end()
  return task.done
}
async function waitReady(task) {
  const deadline = Date.now() + 4000
  while (!task.messages.some(message => message.event === 'ready')) {
    assert.ok(Date.now() < deadline && task.child.exitCode === null, 'Producer failed to become ready')
    await delay(10)
  }
}
function pixels(width, height) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      data[offset] = Math.floor(y / height * 250)
      data[offset + 1] = Math.floor(x / width * 250)
      data[offset + 2] = x < width / 2 ? 255 : 32
      data[offset + 3] = 255
    }
  }
  return data
}
async function startProducer(width, height) {
  const task = launch(['stream', '--width', String(width), '--height', String(height), '--fps', '30'])
  await waitReady(task)
  const frame = pixels(width, height)
  let running = true
  const pumping = (async () => {
    while (running) {
      if (!task.child.stdin.write(frame)) await once(task.child.stdin, 'drain')
      await delay(34)
    }
  })()
  return {
    ...task,
    async pause() { running = false; await pumping },
    async stop() { running = false; await pumping; task.child.stdin.end(); return task.done },
  }
}

const before = await command(['status'])
assert.equal(before.code, 0)
const fallback = await command(['self-test'])
assert.equal(fallback.code, 0, fallback.stdout)
assert.equal(fallback.messages.at(-1).formats, 8)
let testedFrames = fallback.messages.at(-1).frames
for (const [width, height] of [[1920, 1080], [1080, 1920], [1280, 720], [720, 1280]]) {
  const producer = await startProducer(width, height)
  try {
    await delay(150)
    const conflicting = await command(['stream'])
    assert.equal(conflicting.code, 1)
    assert.equal(conflicting.messages[0].code, 170, 'A second producer must be rejected as busy')
    const result = await command(['self-test', '--require-live'])
    assert.equal(result.code, 0, result.stdout)
    assert.equal(result.messages.at(-1).live, true)
    assert.equal(result.messages.at(-1).formats, 8)
    testedFrames += result.messages.at(-1).frames
    console.log(JSON.stringify({ test: 'producer-to-filter', width, height, formats: 8, frames: result.messages.at(-1).frames }))
    if (width === 720) {
      await producer.pause()
      await delay(2200)
      const stale = await command(['self-test'])
      assert.equal(stale.code, 0, stale.stdout)
      assert.equal(stale.messages.at(-1).live, false)
      console.log(JSON.stringify({ test: 'stale-frame-is-black', formats: 8 }))
    }
  } finally {
    const stopped = await producer.stop()
    assert.equal(stopped.code, 0, stopped.stdout)
    assert.equal(stopped.messages.at(-1).event, 'stopped')
    assert.ok(stopped.messages.at(-1).frames >= 1)
  }
}
const truncated = launch(['stream'])
await waitReady(truncated)
truncated.child.stdin.end(Buffer.alloc(31))
const truncatedResult = await truncated.done
assert.equal(truncatedResult.code, 1)
assert.equal(truncatedResult.messages.at(-1).code, 13)
const unsupported = await command(['stream', '--width', '4000', '--height', '4000'])
assert.equal(unsupported.code, 1)
const after = await command(['status'])
assert.deepEqual(after.messages, before.messages, 'Verification must not register or uninstall a camera')
console.log(JSON.stringify({ passed: true, testedFrames, registrationUnchanged: true }))
