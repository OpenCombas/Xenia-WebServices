import { ApiProperty } from '@nestjs/swagger';
import { PlayerPresence } from 'src/infrastructure/presentation/responses/PlayerPresence';

// --- request bodies ---

// Address a request by XUID or by gamertag (exactly one).
export class FriendRequestRequest {
  @ApiProperty()
  fromXuid: string;
  @ApiProperty({ required: false })
  toXuid?: string;
  @ApiProperty({ required: false })
  toGamertag?: string;
}

// accept / decline / cancel / remove all act on a pair.
export class FriendPairRequest {
  @ApiProperty()
  xuid: string;
  @ApiProperty()
  otherXuid: string;
}

// --- response shapes ---

export interface IncomingRequest {
  fromXuid: string;
  fromGamertag: string;
}
export interface OutgoingRequest {
  toXuid: string;
  toGamertag: string;
}

// A friend carries full presence (same shape as /players/presence) plus `online`,
// which is the live-WS connection-liveness (independent of the DB state bitfield).
export interface FriendPresence extends PlayerPresence {
  online: boolean;
}

export interface FriendsResponse {
  friends: FriendPresence[];
  incoming: IncomingRequest[];
  outgoing: OutgoingRequest[];
}
