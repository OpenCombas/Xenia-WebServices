import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RecentEncounterDocument = RecentEncounter & Document;

// One directed "recently played with" edge: ownerXuid encountered otherXuid in a shared session.
// Capture writes both directions (A->B and B->A) so each side's list is independent. gamertag is a
// DENORMALIZED snapshot of otherXuid's name: an encounter lives ~30d but the other player's Player doc
// TTLs at 1d, so a later re-lookup can't be relied on to still have their name.
@Schema()
export class RecentEncounter {
  @Prop({ required: true })
  ownerXuid: string;

  @Prop({ required: true })
  otherXuid: string;

  @Prop({ required: true })
  gamertag: string;

  @Prop({ required: true, default: 1 })
  encounterCount: number;

  // Refreshed on every re-encounter; drives newest-first ordering AND the 30-day TTL prune.
  @Prop({ type: Date, expires: '30d', default: Date.now, required: true })
  lastSeen: Date;
}

export const RecentEncounterSchema = SchemaFactory.createForClass(RecentEncounter);

// One row per directed pair — the capture upserts on it.
RecentEncounterSchema.index({ ownerXuid: 1, otherXuid: 1 }, { unique: true });
// Newest-first read per owner (list + last-N trim).
RecentEncounterSchema.index({ ownerXuid: 1, lastSeen: -1 });
