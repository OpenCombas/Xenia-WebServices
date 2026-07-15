import { ApiProperty } from '@nestjs/swagger';

// --- request bodies ---

export class CreatePartyRequest {
  @ApiProperty()
  ownerXuid: string;
}

export class InvitePartyRequest {
  @ApiProperty()
  fromXuid: string;
  @ApiProperty()
  targetXuid: string;
}

// join / leave / decline all take just the acting member's xuid.
export class MemberRequest {
  @ApiProperty()
  xuid: string;
}

// --- response shapes (the controller returns plain objects in this shape) ---

export interface PartyMemberResponse {
  xuid: string;
  gamertag: string;
  peer_key: string; // console MAC (12 hex upper); the client's voice-mesh key
}

export interface PartyResponse {
  partyId: string;
  ownerXuid: string;
  members: PartyMemberResponse[];
}

export interface InviteResponse {
  partyId: string;
  fromXuid: string;
  fromGamertag: string;
}

export interface PollResponse {
  party: PartyResponse | null;
  invites: InviteResponse[];
}
