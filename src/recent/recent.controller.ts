import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecentService } from './recent.service';
import { RecentClearRequest, RecentRemoveRequest } from './dto/recent.dto';

// Server-owned "recently played with" feed — the add-friend feeder for the server-side friends flow.
// Encounters are captured server-authoritatively at session-join time; clients never write them (only
// read / remove / clear). See server.md "Recent-players (/recent) contract".
@ApiTags('Recent')
@Controller('/recent')
export class RecentController {
  constructor(private readonly recent: RecentService) {}

  // THE read: newest-first encounters, capped at min(limit, 50) (default 25).
  @Get()
  list(@Query('xuid') xuid: string, @Query('limit') limit?: string) {
    return this.recent.list(xuid, limit ? parseInt(limit, 10) : 0);
  }

  // Single-remove — POST (not DELETE) so the client can send a body.
  @Post('remove')
  remove(@Body() body: RecentRemoveRequest) {
    return this.recent.remove(body.xuid, body.otherXuid);
  }

  // Wipe the caller's whole recent list.
  @Post('clear')
  clear(@Body() body: RecentClearRequest) {
    return this.recent.clear(body.xuid);
  }
}
