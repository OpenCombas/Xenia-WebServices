import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlayerDocument = Player & Document;

@Schema()
export class Player {
  @Prop({ required: true, unique: true })
  xuid: string;
  @Prop({ required: true })
  gamertag: string;
  @Prop({ required: true })
  settings: Map<string, Array<string>>;
  @Prop({ required: true })
  machineId: string;
  @Prop({ required: true })
  hostAddress: string;
  @Prop({ required: true })
  macAddress: string;
  @Prop({ required: true })
  port: number;
  @Prop()
  sessionId?: string;
  @Prop({ type: Date, expires: '1d', default: Date.now(), required: true })
  updatedAt: Date;
  @Prop()
  titleId?: string;
  @Prop()
  state?: number;
  @Prop()
  richPresence?: string;
}

export const PlayerSchema = SchemaFactory.createForClass(Player);

// hostAddress is the synthetic (MAC-derived) online IP; both it and the MAC are
// used to look players up (session-create fallback, delete-my-profiles, session
// cleanup), so index them.
PlayerSchema.index({ hostAddress: 1 });
PlayerSchema.index({ macAddress: 1 });
