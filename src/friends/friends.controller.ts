import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { FriendPairRequest, FriendRequestRequest } from './dto/friends.dto';

// Standalone, poll-native, server-owned friends service. Symmetric: a relationship
// is only 'accepted' after the recipient accepts. See server.md "Friends service
// API contract (2026-07-14)".
@ApiTags('Friends')
@Controller('/friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @Post('request')
  request(@Body() body: FriendRequestRequest) {
    return this.friends.request(body.fromXuid, body.toXuid, body.toGamertag);
  }

  @Post('accept')
  accept(@Body() body: FriendPairRequest) {
    return this.friends.accept(body.xuid, body.otherXuid);
  }

  // decline (recipient), cancel (requester), remove (unfriend) — all delete the pair.
  @Post('decline')
  decline(@Body() body: FriendPairRequest) {
    return this.friends.remove(body.xuid, body.otherXuid);
  }

  @Post('cancel')
  cancel(@Body() body: FriendPairRequest) {
    return this.friends.remove(body.xuid, body.otherXuid);
  }

  @Post('remove')
  remove(@Body() body: FriendPairRequest) {
    return this.friends.remove(body.xuid, body.otherXuid);
  }

  // The poll: accepted friends (with presence) + pending requests.
  @Get()
  list(@Query('xuid') xuid: string) {
    return this.friends.list(xuid);
  }
}
