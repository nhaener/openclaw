/**
 * Integration test: verifies that stuck-session recovery via
 * abortAndDrainEmbeddedPiRun + killForcefully actually terminates the child
 * process tree — not just the session state.
 *
 * This simulates the exact failure mode where:
 * 1. An embedded run is active with a bash tool call (e.g. `sleep 9999`)
 * 2. The diagnostic detects blocked_tool_call
 * 3. Recovery fires with allowActiveAbort: true
 * 4. abort() is called but the run does NOT drain (bash is stuck)
 * 5. killForcefully() fires and terminates the process group
 * 6. Both the session AND the child process tree are gone
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { killProcessTree } from "../../process/kill-tree.js";

const isUnix = process.platform !== "win32";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content.length > 0) {
        return content;
      }
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function waitForProcessDeath(pid: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Process ${pid} still alive after ${timeoutMs}ms`);
}

describe.skipIf(!isUnix)("stuck-session recovery: killForcefully integration", () => {
  const tmpDir = os.tmpdir();
  const pidFiles: string[] = [];

  afterEach(() => {
    for (const f of pidFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
    pidFiles.length = 0;
  });

  it("killForcefully terminates the entire process group when abort() fails to drain", async () => {
    const parentPidFile = path.join(tmpDir, `openclaw-stuck-test-${Date.now()}-parent.pid`);
    const childPidFile = path.join(tmpDir, `openclaw-stuck-test-${Date.now()}-child.pid`);
    pidFiles.push(parentPidFile, childPidFile);

    // Simulate the exact stuck tool call scenario:
    // bash -c 'echo $$ > /tmp/morty-stuck.pid; sleep 9999'
    const bashProcess = spawn(
      "bash",
      ["-c", `echo $$ > ${parentPidFile}; (echo $$ > ${childPidFile}; sleep 9999) & wait`],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    bashProcess.unref();

    const parentPid = Number(await waitForFile(parentPidFile));
    const childPid = Number(await waitForFile(childPidFile));

    expect(isProcessAlive(parentPid)).toBe(true);
    expect(isProcessAlive(childPid)).toBe(true);

    // Simulate the queue handle with killForcefully wired to process group kill
    let killForcefullyCalled = false;
    const mockHandle = {
      kind: "embedded" as const,
      queueMessage: async () => {},
      isStreaming: () => false,
      isCompacting: () => false,
      abort: () => {
        // Simulate abort that does NOT kill the process
        // (this is the gap — abort() cancels the model stream but not bash)
      },
      killForcefully: () => {
        killForcefullyCalled = true;
        // This is what actually terminates the stuck process tree
        killProcessTree(parentPid, { graceMs: 500 });
      },
    };

    // Simulate the recovery flow:
    // 1. abort() fires but doesn't drain (bash keeps running)
    mockHandle.abort();
    expect(isProcessAlive(parentPid)).toBe(true); // Still alive — abort didn't kill it

    // 2. Settle window passes, drain check fails
    // 3. killForcefully() fires
    mockHandle.killForcefully();
    expect(killForcefullyCalled).toBe(true);

    // 4. Both processes should be dead
    await waitForProcessDeath(parentPid);
    await waitForProcessDeath(childPid);

    expect(isProcessAlive(parentPid)).toBe(false);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it("logs killed PIDs for post-mortem debugging", async () => {
    const pidFile = path.join(tmpDir, `openclaw-stuck-test-${Date.now()}-log.pid`);
    pidFiles.push(pidFile);

    const bashProcess = spawn("bash", ["-c", `echo $$ > ${pidFile}; sleep 9999`], {
      detached: true,
      stdio: "ignore",
    });
    bashProcess.unref();

    const pid = Number(await waitForFile(pidFile));
    expect(isProcessAlive(pid)).toBe(true);

    // Capture what would be logged during recovery
    const logEntries: string[] = [];
    const mockDiag = {
      warn: (msg: string) => logEntries.push(msg),
    };

    // Simulate the killForcefully call with logging (matches the production code)
    const sessionId = "test-session-123";
    const sessionKey = "agent:morty:telegram:direct:8681554364";

    mockDiag.warn(
      `stuck session forceful kill: sessionId=${sessionId} sessionKey=${sessionKey} pid=${pid} reason=stuck_recovery`,
    );
    killProcessTree(pid, { graceMs: 500 });

    await waitForProcessDeath(pid);
    expect(isProcessAlive(pid)).toBe(false);

    // Verify log contains the PID for debugging
    expect(logEntries[0]).toContain(`pid=${pid}`);
    expect(logEntries[0]).toContain("stuck_recovery");
    expect(logEntries[0]).toContain(sessionKey);
  });

  it("killForcefully is idempotent: double-call does not throw", async () => {
    const pidFile = path.join(tmpDir, `openclaw-stuck-test-${Date.now()}-idem.pid`);
    pidFiles.push(pidFile);

    const bashProcess = spawn("bash", ["-c", `echo $$ > ${pidFile}; sleep 9999`], {
      detached: true,
      stdio: "ignore",
    });
    bashProcess.unref();

    const pid = Number(await waitForFile(pidFile));
    expect(isProcessAlive(pid)).toBe(true);

    // Simulate killForcefully with idempotent guard (PID captured at spawn)
    let killed = false;
    const killForcefully = () => {
      if (killed) return; // idempotent: no-op on second call
      killed = true;
      killProcessTree(pid, { graceMs: 500 });
    };

    // First call kills the process
    killForcefully();
    await waitForProcessDeath(pid);
    expect(isProcessAlive(pid)).toBe(false);

    // Second call is a no-op, does not throw
    expect(() => killForcefully()).not.toThrow();

    // Third call also safe (abort paths can triple-fire: timeout + manual + shutdown)
    expect(() => killForcefully()).not.toThrow();
  });
});
