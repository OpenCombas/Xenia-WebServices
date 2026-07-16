import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RecoverRequest, TokenRequest } from './dto/auth.dto';
import { bearerToken } from './bearer';

// Auth endpoints. NOTE: the primary claim/re-issue path is folded into POST /players (RegisterPlayer),
// per the client contract — these are the explicit re-auth / recovery / logout paths the client wires
// later. See adr-0002-authentication.
@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Explicit re-auth (new install / lost token): password -> a fresh token.
  @Post('token')
  token(@Body() body: TokenRequest) {
    return this.auth.issueToken(body.xuid, body.password);
  }

  // Email-free reset: recovery code -> set a new password, rotate the recovery code, revoke all tokens.
  @Post('recover')
  recover(@Body() body: RecoverRequest) {
    return this.auth.recover(body.xuid, body.recoveryCode, body.newPassword);
  }

  // Logout: revoke the presented token.
  @Post('revoke')
  revoke(@Req() req: Request) {
    return this.auth.revoke(bearerToken(req));
  }
}
