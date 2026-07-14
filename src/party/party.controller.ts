import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PartyService } from './party.service';
import {
  CreatePartyRequest,
  InvitePartyRequest,
  MemberRequest,
} from './dto/party.dto';

// Standalone, poll-native party service (decoupled from game sessions). See
// server.md "Party service API contract (2026-07-14)" for the wire contract.
@ApiTags('Party')
@Controller('/party')
export class PartyController {
  constructor(private readonly party: PartyService) {}

  @Post()
  create(@Body() body: CreatePartyRequest) {
    return this.party.create(body.ownerXuid);
  }

  @Post(':partyId/invite')
  invite(
    @Param('partyId') partyId: string,
    @Body() body: InvitePartyRequest,
  ) {
    return this.party.invite(partyId, body.fromXuid, body.targetXuid);
  }

  @Post(':partyId/join')
  join(@Param('partyId') partyId: string, @Body() body: MemberRequest) {
    return this.party.join(partyId, body.xuid);
  }

  @Post(':partyId/leave')
  leave(@Param('partyId') partyId: string, @Body() body: MemberRequest) {
    return this.party.leave(partyId, body.xuid);
  }

  @Post(':partyId/decline')
  decline(@Param('partyId') partyId: string, @Body() body: MemberRequest) {
    return this.party.decline(partyId, body.xuid);
  }

  // The push-via-poll: the client polls this at dashboard level (title-agnostic).
  @Get('poll')
  poll(@Query('xuid') xuid: string) {
    return this.party.poll(xuid);
  }
}
