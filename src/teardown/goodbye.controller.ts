import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TeardownService } from './teardown.service';

// POST /goodbye — the client calls this on clean exit (XLiveAPI::StopGNS) to tear down its transient state
// immediately, instead of waiting for the WS-disconnect catch-all. Idempotent; both `xuid` and `mac`
// (console MAC) are needed since sessions are MAC-keyed. Returns { ok: true } always (best-effort).
class GoodbyeRequest {
  xuid: string;
  mac: string;
}

@ApiTags('Goodbye')
@Controller('/goodbye')
export class GoodbyeController {
  constructor(private readonly teardown: TeardownService) {}

  @Post()
  async goodbye(@Body() body: GoodbyeRequest): Promise<{ ok: true }> {
    await this.teardown.teardown(body.xuid, body.mac);
    return { ok: true };
  }
}
