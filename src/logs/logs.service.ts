import { Injectable, Logger } from '@nestjs/common';
import { Readable, Transform } from 'stream';
import type { IncomingHttpHeaders } from 'http';

// Result of the GET /logs capability gate.
export type GateCode = 200 | 404 | 503;

// A backend-forward result the controller relays verbatim.
export interface ForwardResult {
  status: number;
  body: string;
  contentType: string;
}

export class LogTooLargeError extends Error {}
export class BackendUnavailableError extends Error {}

// --- pure rate-limit helper (unit-tested) ---

// pruneAndCheck drops timestamps outside the window, then reports whether another hit is allowed and the
// pruned list (with `now` appended when allowed). Sliding-window, keyed per caller by the service.
export function pruneAndCheck(
  times: number[],
  now: number,
  max: number,
  windowMs: number,
): { allowed: boolean; kept: number[] } {
  const kept = times.filter((t) => now - t < windowMs);
  if (kept.length >= max) return { allowed: false, kept };
  kept.push(now);
  return { allowed: true, kept };
}

// LogsService is a THIN, STATELESS proxy: it streams the gzip upload straight through to an authenticated
// ingest backend on another server (which gunzips + pushes to a log indexer). It never writes to disk,
// never gunzips, and holds no state beyond an in-memory rate-limit window. See project_log_ingestion memory.
@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);

  private readonly enabledFlag = process.env.LOGS_ENABLED === 'true';
  private readonly backendUrl = process.env.LOG_BACKEND_URL ?? '';
  private readonly backendToken = process.env.LOG_BACKEND_TOKEN ?? '';
  private readonly maxBytes =
    (parseInt(process.env.LOG_MAX_MB ?? '', 10) || 64) * 1024 * 1024;
  private readonly rateMax = parseInt(process.env.LOG_RATE_MAX ?? '', 10) || 5;
  private readonly rateWindowMs =
    parseInt(process.env.LOG_RATE_WINDOW_MS ?? '', 10) || 60_000;

  private readonly hits = new Map<string, number[]>();

  // gate: 200 accepting, 404 disabled (client hides the button), 503 enabled-but-misconfigured.
  gate(): GateCode {
    if (!this.enabledFlag) return 404;
    if (!this.backendUrl) return 503;
    return 200;
  }

  // allow: per-key (xuid, else IP) sliding-window rate limit.
  allow(key: string): boolean {
    const now = Date.now();
    const { allowed, kept } = pruneAndCheck(
      this.hits.get(key) ?? [],
      now,
      this.rateMax,
      this.rateWindowMs,
    );
    this.hits.set(key, kept);
    return allowed;
  }

  // forward streams the request body to the backend, capping bytes mid-stream (never buffers the whole
  // upload) and forwarding the X-Xenia-* + Content-Encoding/Type headers plus the proxy->backend bearer.
  async forward(
    reqStream: Readable,
    headers: IncomingHttpHeaders,
  ): Promise<ForwardResult> {
    let tooLarge = false;
    let total = 0;
    const cap = new Transform({
      transform: (chunk: Buffer, _enc, cb) => {
        total += chunk.length;
        if (total > this.maxBytes) {
          tooLarge = true;
          cb(new LogTooLargeError());
          return;
        }
        cb(null, chunk);
      },
    });

    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const lk = k.toLowerCase();
      if (
        typeof v === 'string' &&
        (lk.startsWith('x-xenia-') ||
          lk === 'content-encoding' ||
          lk === 'content-type')
      ) {
        out[lk] = v;
      }
    }
    if (this.backendToken) out['authorization'] = `Bearer ${this.backendToken}`;

    const capped = reqStream.pipe(cap);
    try {
      const resp = await fetch(this.backendUrl, {
        method: 'POST',
        headers: out,
        body: Readable.toWeb(capped) as unknown as BodyInit,
        // Node/undici requires duplex for a streaming request body (not in the DOM RequestInit type).
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      const body = await resp.text();
      return {
        status: resp.status,
        body,
        contentType: resp.headers.get('content-type') ?? 'application/json',
      };
    } catch (err) {
      if (tooLarge) throw new LogTooLargeError();
      this.logger.warn(`log backend forward failed: ${err}`);
      throw new BackendUnavailableError();
    }
  }
}
