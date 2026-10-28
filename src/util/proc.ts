import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  input?: NodeJS.ReadableStream | Buffer | string;
  /** Keep this many bytes of stdout in the result (default 8 MB). */
  maxStdout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a program without a shell. Arguments are passed as an array, so paths with
 * spaces, quotes or Windows drive letters need no escaping.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    });
    const maxOut = opts.maxStdout ?? 8 * 1024 * 1024;
    let stdout = '';
    let stderrTail = '';
    let outBuf = '';
    let errBuf = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort);
    }
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(`${cmd} took too long and was stopped.`)));
      }, opts.timeoutMs);
    }

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (stdout.length < maxOut) stdout += chunk;
      if (opts.onStdoutLine) {
        outBuf += chunk;
        const lines = outBuf.split(/\r?\n/);
        outBuf = lines.pop() ?? '';
        for (const l of lines) opts.onStdoutLine(l);
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-64 * 1024);
      if (opts.onStderrLine) {
        errBuf += chunk;
        const lines = errBuf.split(/\r|\n/);
        errBuf = lines.pop() ?? '';
        for (const l of lines) if (l) opts.onStderrLine(l);
      }
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      if (outBuf && opts.onStdoutLine) opts.onStdoutLine(outBuf);
      if (errBuf && opts.onStderrLine) opts.onStderrLine(errBuf);
      finish(() => resolve({ code, stdout, stderr: stderrTail }));
    });

    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {
        /* the process may exit before reading all input */
      });
      if (typeof opts.input === 'string' || Buffer.isBuffer(opts.input)) child.stdin.end(opts.input);
      else (opts.input as NodeJS.ReadableStream).pipe(child.stdin);
    }
  });
}

/** Last meaningful lines of ffmpeg stderr, for error messages. */
export function tailLines(text: string, n = 6): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\s*(frame=|size=|Press \[q\])/.test(l))
    .slice(-n)
    .join('\n');
}
