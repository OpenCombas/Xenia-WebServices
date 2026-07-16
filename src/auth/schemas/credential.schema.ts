import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CredentialDocument = Credential & Document;

// One durable credential per claimed xuid (TOFU — first console to register an xuid owns it). The password
// is the client-generated device-secret; the recovery code is a one-time escape hatch. Both are scrypt
// hashes, never stored in the clear. No email anywhere.
@Schema({ timestamps: true })
export class Credential {
  @Prop({ required: true, unique: true })
  xuid: string;

  @Prop({ required: true })
  passwordHash: string; // scrypt "salt:key"

  @Prop({ required: true })
  recoveryHash: string; // scrypt "salt:key"
}

export const CredentialSchema = SchemaFactory.createForClass(Credential);
