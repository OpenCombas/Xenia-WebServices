import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// One member of a party. gamertag + peerKey (console MAC) are snapshotted from the
// member's login record (Players) at join time — both are stable per console — so a
// poll can return the full roster without re-reading the Players collection.
@Schema({ _id: false })
export class PartyMember {
  @Prop({ required: true })
  xuid: string;
  @Prop({ required: true })
  gamertag: string;
  @Prop({ required: true })
  peerKey: string; // 48-bit console MAC, 12 hex upper (== MacAddress.toString()); the voice-mesh key
  @Prop({ type: Date, default: Date.now, required: true })
  lastPoll: Date;
}
const PartyMemberSchema = SchemaFactory.createForClass(PartyMember);

export type PartyDocument = Party & Document;

@Schema()
export class Party {
  @Prop({ required: true, unique: true })
  partyId: string;
  @Prop({ required: true })
  ownerXuid: string;
  @Prop({ type: [PartyMemberSchema], required: true })
  members: PartyMember[];
  // Bumped on every mutation/poll; the TTL is a backstop that sweeps a fully
  // abandoned party (nobody polling) after 10 min, behind the 30s per-member reap.
  @Prop({ type: Date, expires: '10m', default: Date.now, required: true })
  lastActivity: Date;
}

export const PartySchema = SchemaFactory.createForClass(Party);

// Poll looks a caller's party up by membership.
PartySchema.index({ 'members.xuid': 1 });
