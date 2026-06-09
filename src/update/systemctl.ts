import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type Exec = (cmd: string, args: string[]) => Promise<unknown>;

/**
 * Restart a systemd unit so it picks up a freshly installed binary. Rejects (propagating the
 * underlying error) if systemctl is missing or the restart fails. `exec` is injectable for testing.
 */
export async function systemctlRestart(unit: string, exec: Exec = execFileAsync): Promise<void> {
    await exec("systemctl", ["restart", unit]);
}
