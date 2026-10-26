export const LOCAL_REQUEST_TIMEOUT_MS = 20_000;

export class RequestDeadlineError extends Error {
  constructor() { super('The local service did not respond in time'); this.name = 'RequestDeadlineError'; }
}

/** Bound a request even when its transport fails to observe abort promptly. */
export async function withRequestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAborted!: (error: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const abort = () => {
    const reason = options.signal?.reason ?? new DOMException('Request canceled', 'AbortError');
    controller.abort(reason); rejectAborted(reason);
  };
  if (options.signal?.aborted) throw options.signal.reason;
  options.signal?.addEventListener('abort', abort, { once: true });
  timer = setTimeout(() => {
    const reason = new RequestDeadlineError();
    controller.abort(reason); rejectAborted(reason);
  }, options.timeoutMs ?? LOCAL_REQUEST_TIMEOUT_MS);
  try { return await Promise.race([run(controller.signal), interrupted]); }
  catch (error) { controller.abort(error); throw error; }
  finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
