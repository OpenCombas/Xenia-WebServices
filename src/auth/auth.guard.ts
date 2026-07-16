import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { bearerToken } from './bearer';

// Verifies a Bearer token and attaches `req.authXuid`. Rollout via AUTH_ENFORCE:
//   off/soft -> a MISSING token is allowed (req.authXuid undefined; legacy xuid-in-body still works);
//   hard     -> a token is required.
// A PRESENT-but-invalid token is ALWAYS rejected (a bad token is an error, not "unauthenticated").
//
// NOT applied globally yet — Phase 1 attaches it to xuid-scoped mutation routes and adds ownership checks
// (req.authXuid === the body/param xuid). Shipping it now keeps the wiring ready.
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly enforce = (process.env.AUTH_ENFORCE ?? 'soft').toLowerCase();

  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { authXuid?: string }>();
    const token = bearerToken(req);
    if (!token) {
      if (this.enforce === 'hard') {
        throw new UnauthorizedException({ error: 'token_required' });
      }
      return true; // soft / off
    }
    const xuid = await this.auth.verifyToken(token);
    if (!xuid) throw new UnauthorizedException({ error: 'invalid_token' });
    req.authXuid = xuid;
    return true;
  }
}
