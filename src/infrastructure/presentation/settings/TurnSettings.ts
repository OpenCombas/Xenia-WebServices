import { Injectable } from '@nestjs/common';
import AbstractEnvSettings from '../../AbstractEnvSettings';

export interface TurnSettingsProps {
  keyId: string; // Cloudflare Realtime TURN Key ID
  apiToken: string; // Cloudflare Realtime TURN API token (Bearer)
  ttl: number; // credential lifetime in seconds
}

@Injectable()
export default class TurnSettings extends AbstractEnvSettings<TurnSettingsProps> {
  public get() {
    return <TurnSettingsProps>this.getFullConfig().turn;
  }
}
