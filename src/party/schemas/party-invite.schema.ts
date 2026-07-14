import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartyInviteDocument = PartyInvite & Document;

// A pending invite for targetXuid to join a party. Delivered to the target on their
// poll; TTL-expires after 60s so ignored invites clean themselves up.
@Schema()
export class PartyInvite {
  @Prop({ required: true })
  partyId: string;
  @Prop({ required: true })
  targetXuid: string;
  @Prop({ required: true })
  fromXuid: string;
  @Prop({ required: true })
  fromGamertag: string;
  @Prop({ type: Date, expires: '60s', default: Date.now, required: true })
  createdAt: Date;
}

export const PartyInviteSchema = SchemaFactory.createForClass(PartyInvite);

PartyInviteSchema.index({ targetXuid: 1 });
PartyInviteSchema.index({ partyId: 1, targetXuid: 1 }, { unique: true });
