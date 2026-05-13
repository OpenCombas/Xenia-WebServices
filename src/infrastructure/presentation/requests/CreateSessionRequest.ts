export interface CreateSessionRequest {
  xuid: string;
  title: string;
  mediaId: string;
  version: string;
  xeniaVersion: string;
  sessionId: string;
  flags: number;
  publicSlotsCount: number;
  privateSlotsCount: number;
  hostAddress: string;
  macAddress: string;
  port: number;
}
