import { ApiProperty } from '@nestjs/swagger';

export class CreatePlayerRequest {
  @ApiProperty()
  xuid: string;
  @ApiProperty()
  gamertag: string;
  @ApiProperty()
  machineId: string;
  @ApiProperty()
  hostAddress: string;
  @ApiProperty()
  macAddress: string;
  @ApiProperty()
  settings: Map<string, Array<string>>;
  // Client-generated device-secret (base64url). When present, RegisterPlayer claims/re-issues auth and the
  // response carries { token, recoveryCode? }. Optional — a tokenless (legacy) client omits it. See adr-0002.
  @ApiProperty({ required: false })
  password?: string;
}
