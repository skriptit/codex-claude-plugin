import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
let selfIdentity = null;
export function identity(pid = process.pid) {
    if (pid === process.pid && selfIdentity)
        return selfIdentity;
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return null;
    try {
        let start;
        if (process.platform === 'linux') {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            if (fields[0] === 'Z')
                return null;
            start = fields[19];
        }
        else if (process.platform === 'win32') {
            start = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        }
        else {
            start = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        }
        const value = start ? { pid, start } : null;
        if (pid === process.pid)
            selfIdentity = value;
        return value;
    }
    catch {
        return null;
    }
}
export const alive = (owner) => identity(owner.pid)?.start === owner.start;
//# sourceMappingURL=identity.js.map