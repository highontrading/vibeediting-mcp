import { randomBytes } from 'node:crypto';
import { errorMessage } from './util/errors.js';
import { log } from './util/log.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobContent {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface JobResult {
  content: JobContent[];
}

export interface JobControl {
  progress(fraction: number, message?: string): void;
  signal: AbortSignal;
}

export interface Job {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  progress: number;
  message: string;
  result?: JobResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  abort: AbortController;
}

type Listener = (job: Job) => void;

/**
 * Runs long work (render, transcription, analysis) in the background, one heavy job
 * at a time, so tools return quickly and the client never times out.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private listeners = new Map<string, Set<Listener>>();
  private queue: Array<{ job: Job; fn: (ctl: JobControl) => Promise<JobResult> }> = [];
  private running = 0;
  private readonly concurrency: number;

  constructor(concurrency = 1) {
    this.concurrency = concurrency;
  }

  start(kind: string, label: string, fn: (ctl: JobControl) => Promise<JobResult>): Job {
    const id = `${kind}-${randomBytes(3).toString('hex')}`;
    const job: Job = {
      id,
      kind,
      label,
      status: 'queued',
      progress: 0,
      message: 'Waiting to start',
      createdAt: Date.now(),
      abort: new AbortController(),
    };
    this.jobs.set(id, job);
    this.queue.push({ job, fn });
    this.pump();
    this.prune();
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return false;
    job.abort.abort();
    if (job.status === 'queued') {
      this.queue = this.queue.filter((q) => q.job.id !== id);
      this.finish(job, 'cancelled', undefined, 'Cancelled');
    }
    return true;
  }

  /** Wait until the job ends or `ms` passes. Calls onUpdate on every progress change. */
  wait(id: string, ms: number, onUpdate?: Listener): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) return Promise.reject(new Error(`No job with id ${id}`));
    if (isFinal(job.status) || ms <= 0) return Promise.resolve(job);
    return new Promise((resolve) => {
      const set = this.listeners.get(id) ?? new Set();
      this.listeners.set(id, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(listener);
        resolve(job);
      };
      const listener: Listener = (j) => {
        onUpdate?.(j);
        if (isFinal(j.status)) done();
      };
      const timer = setTimeout(done, ms);
      set.add(listener);
    });
  }

  private emit(job: Job): void {
    for (const l of this.listeners.get(job.id) ?? []) {
      try {
        l(job);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.running++;
      void this.exec(next.job, next.fn).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async exec(job: Job, fn: (ctl: JobControl) => Promise<JobResult>): Promise<void> {
    job.status = 'running';
    job.startedAt = Date.now();
    job.message = 'Started';
    this.emit(job);
    let lastEmit = 0;
    const ctl: JobControl = {
      signal: job.abort.signal,
      progress: (fraction, message) => {
        job.progress = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
        if (message) job.message = message;
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          this.emit(job);
        }
      },
    };
    try {
      const result = await fn(ctl);
      if (job.abort.signal.aborted) this.finish(job, 'cancelled', undefined, 'Cancelled');
      else this.finish(job, 'done', result);
    } catch (err) {
      if (job.abort.signal.aborted) this.finish(job, 'cancelled', undefined, 'Cancelled');
      else {
        log.error(`job ${job.id} failed`, err);
        this.finish(job, 'failed', undefined, errorMessage(err));
      }
    }
  }

  private finish(job: Job, status: JobStatus, result?: JobResult, error?: string): void {
    job.status = status;
    job.finishedAt = Date.now();
    if (status === 'done') {
      job.progress = 1;
      job.message = 'Finished';
    }
    job.result = result;
    job.error = error;
    this.emit(job);
    this.listeners.delete(job.id);
  }

  /** Keep the last 50 finished jobs. */
  private prune(): void {
    const finished = this.list().filter((j) => isFinal(j.status));
    for (const j of finished.slice(50)) this.jobs.delete(j.id);
  }
}

export function isFinal(s: JobStatus): boolean {
  return s === 'done' || s === 'failed' || s === 'cancelled';
}
