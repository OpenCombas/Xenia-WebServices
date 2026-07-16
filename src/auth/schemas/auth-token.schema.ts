import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AuthTokenDocument = AuthToken & Document;

// One row per issued bearer token. Only the sha256 of the token is stored (a DB leak never yields a usable
// token). `expiresAt` is a TTL index — Mongo auto-deletes the row once it passes, so idle tokens self-expire
// and revocation is just a delete. `expiresAt`/`lastUsedAt` slide forward on each successful use.
@Schema()
export class AuthToken {
  @Prop({ required: true, unique: true, index: true })
  tokenHash: string; // sha256(token) hex

  @Prop({ required: true, index: true })
  xuid: string;

  @Prop({ type: Date, default: Date.now, required: true })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now, required: true })
  lastUsedAt: Date;

  // TTL: expireAfterSeconds 0 on a date field deletes the doc when the date is reached.
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt: Date;
}

export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);
