import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  BackendUnavailableError,
  LogsService,
  LogTooLargeError,
} from './logs.service';

// Thin proxy for tester log uploads. GET /logs is the capability gate the client throttle-probes; POST
// /logs streams the raw-gzip body straight through to the authenticated ingest backend. Nothing is written
// to disk or gunzipped here. Contract: server.md / project_log_ingestion. Auth is xuid-trust for now
// (folds into the bearer guard later, send-if-present).
@ApiTags('Logs')
@Controller('/logs')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  // Capability gate: 200 accepting, 404 off, 503 misconfigured. No body.
  @Get()
  gate(@Res() res: Response): void {
    res.status(this.logs.gate()).end();
  }

  // Ingest: rate-limit, then stream the body to the backend and relay its {id,url}. Uses @Res so the raw
  // request stream (req) is piped untouched — the text/plain body is not consumed by the JSON body parser.
  @Post()
  async ingest(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (this.logs.gate() !== 200) {
      res.status(this.logs.gate()).end();
      return;
    }

    const xuid =
      typeof req.headers['x-xenia-xuid'] === 'string'
        ? req.headers['x-xenia-xuid']
        : '';
    const key = xuid || req.ip || 'anon';
    if (!this.logs.allow(key)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    try {
      const { status, body, contentType } = await this.logs.forward(
        req,
        req.headers,
      );
      res.status(status).setHeader('content-type', contentType);
      res.send(body);
    } catch (err) {
      if (err instanceof LogTooLargeError) {
        res.status(413).json({ error: 'log_too_large' });
      } else if (err instanceof BackendUnavailableError) {
        res.status(502).json({ error: 'backend_unavailable' });
      } else {
        res.status(500).json({ error: 'ingest_failed' });
      }
    }
  }
}
