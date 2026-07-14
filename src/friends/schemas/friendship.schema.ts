import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FriendshipDocument = Friendship & Document;

// A single relationship between two players. The pair is stored CANONICALLY
// (xuidLow <= xuidHigh) and is UNIQUE, so a relationship is one row regardless of
// who asked — that structural uniqueness is what makes friendship symmetric (no
// one-sided "friends"). status 'pending' = requesterXuid asked the other and awaits
// their accept; 'accepted' = mutual friends. Never 'accepted' without an accept.
@Schema({ timestamps: true })
export class Friendship {
  @Prop({ required: true })
  xuidLow: string;
  @Prop({ required: true })
  xuidHigh: string;
  @Prop({ required: true })
  requesterXuid: string;
  @Prop({ required: true, enum: ['pending', 'accepted'] })
  status: 'pending' | 'accepted';
}

export const FriendshipSchema = SchemaFactory.createForClass(Friendship);

// One relationship per pair; list a player's relationships by matching either slot.
FriendshipSchema.index({ xuidLow: 1, xuidHigh: 1 }, { unique: true });
FriendshipSchema.index({ xuidLow: 1 });
FriendshipSchema.index({ xuidHigh: 1 });
