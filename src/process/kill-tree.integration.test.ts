/**
 * Integration test: verifies that killProcessTree actually terminates a real
 * process group including descendants. This is the "the child process tree is
 * gone" assertion that validates the stuck-session recovery kill path.
 *
 * These tests spawn real bash processes, so they only run on Unix.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { killProcessTree } from "./kill-tree.js";

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
      // File not yet written
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

describe.skipIf(!isUnix)("killProcessTree integration (real processes)", () => {
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

  it("kills bash and its sleep child via process group", async () => {
    const pidFile = path.join(tmpDir, `openclaw-kill-test-${Date.now()}-parent.pid`);
    const childPidFile = path.join(tmpDir, `openclaw-kill-test-${Date.now()}-child.pid`);
    pidFiles.push(pidFile, childPidFile);

    // Spawn a detached bash that writes its own PID and spawns a child sleep
    const child = spawn(
      "bash",
      ["-c", `echo $$ > ${pidFile}; (echo $$ > ${childPidFile}; sleep 9999) & wait`],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();

    // Wait for both PIDs to be written
    const parentPidStr = await waitForFile(pidFile);
    const childPidStr = await waitForFile(childPidFile);
    const parentPid = Number(parentPidStr);
    const childPid = Number(childPidStr);

    expect(Number.isFinite(parentPid) && parentPid > 0).toBe(true);
    expect(Number.isFinite(childPid) && childPid > 0).toBe(true);
    expect(isProcessAlive(parentPid)).toBe(true);
    expect(isProcessAlive(childPid)).toBe(true);

    // Kill via process group (detached: true is the default)
    killProcessTree(parentPid, { graceMs: 500 });

    // Wait for both parent and child to die
    await waitForProcessDeath(parentPid);
    await waitForProcessDeath(childPid);

    // Final assertion: both are gone
    expect(isProcessAlive(parentPid)).toBe(false);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it("kills a deeper process tree (bash → child bash → sleep)", async () => {
    const pidFile = path.join(tmpDir, `openclaw-kill-test-${Date.now()}-root.pid`);
    const childPidFile2 = path.join(tmpDir, `openclaw-kill-test-${Date.now()}-child2.pid`);
    const scriptFile = path.join(tmpDir, `openclaw-kill-test-${Date.now()}.sh`);
    pidFiles.push(pidFile, childPidFile2, scriptFile);

    // Use a script file to avoid nested quoting issues
    fs.writeFileSync(
      scriptFile,
      `#!/bin/bash\necho $$ > ${pidFile}\nbash -c 'echo \$\$ > ${childPidFile2}; sleep 9999' &\nwait\n`,
    );
    fs.chmodSync(scriptFile, 0o755);

    const child = spawn("bash", [scriptFile], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const rootPid = Number(await waitForFile(pidFile));
    const childPid2 = Number(await waitForFile(childPidFile2));

    expect(isProcessAlive(rootPid)).toBe(true);
    expect(isProcessAlive(childPid2)).toBe(true);

    // Kill the root; entire tree should die via process group
    killProcessTree(rootPid, { graceMs: 500 });

    await waitForProcessDeath(rootPid);
    await waitForProcessDeath(childPid2);

    expect(isProcessAlive(rootPid)).toBe(false);
    expect(isProcessAlive(childPid2)).toBe(false);
  });

  it("SIGTERM first, SIGKILL after grace period for stubborn processes", async () => {
    const pidFile = path.join(tmpDir, `openclaw-kill-test-${Date.now()}-stubborn.pid`);
    pidFiles.push(pidFile);

    // Spawn a bash that traps SIGTERM and ignores it
    const child = spawn("bash", ["-c", `echo $$ > ${pidFile}; trap '' TERM; sleep 9999`], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const pid = Number(await waitForFile(pidFile));
    expect(isProcessAlive(pid)).toBe(true);

    // Grace period of 1s: SIGTERM won't work but SIGKILL will
    killProcessTree(pid, { graceMs: 1000 });

    // Should still be alive during grace window (trapped SIGTERM)
    await new Promise((r) => setTimeout(r, 200));
    expect(isProcessAlive(pid)).toBe(true);

    // After grace period, SIGKILL should finish it
    await waitForProcessDeath(pid, 5000);
    expect(isProcessAlive(pid)).toBe(false);
  });
});
