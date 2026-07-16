import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Xuid from 'src/domain/value-objects/Xuid';
import { Credential, CredentialDocument } from './schemas/credential.schema';
import { AuthToken, AuthTokenDocument } from './schemas/auth-token.schema';
import {
  hashSecret,
  hashToken,
  newRecoveryCode,
  newToken,
  verifySecret,
} from './auth.crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly tokenTtlMs =
    (parseInt(process.env.AUTH_TOKEN_TTL_DAYS ?? '', 10) || 90) * 86_400_000;

  constructor(
    @InjectModel(Credential.name)
    private readonly credentials: Model<CredentialDocument>,
    @InjectModel(AuthToken.name)
    private readonly tokens: Model<AuthTokenDocument>,
  ) {}

  // registerOrReissue is folded into POST /players (runs on EVERY title boot), so it is idempotent and
  // NEVER throws — player registration must succeed regardless of the auth outcome:
  //   (a) unclaimed          -> claim (store scrypt password + recovery), return { token, recoveryCode }
  //   (b) claimed + match     -> re-issue, return { token }              (no recoveryCode)
  //   (c) claimed + mismatch  -> return {} (tokenless; the client stays in the soft phase)
  //   (no password provided)  -> return {} (legacy/tokenless client)
  async registerOrReissue(
    xuidRaw: string,
    password?: string,
  ): Promise<{ token?: string; recoveryCode?: string }> {
    if (!password) return {};
    let xuid: string;
    try {
      xuid = new Xuid(xuidRaw).value;
    } catch {
      return {};
    }

    try {
      const cred = await this.credentials.findOne({ xuid });
      if (!cred) {
        const recoveryCode = newRecoveryCode();
        try {
          await this.credentials.create({
            xuid,
            passwordHash: hashSecret(password),
            recoveryHash: hashSecret(recoveryCode),
          });
        } catch {
          // Unique-index race: another claim landed first between find and create -> re-read and verify.
          const raced = await this.credentials.findOne({ xuid });
          if (raced && verifySecret(password, raced.passwordHash)) {
            return { token: await this.mint(xuid) };
          }
          return {};
        }
        return { token: await this.mint(xuid), recoveryCode };
      }
      if (verifySecret(password, cred.passwordHash)) {
        return { token: await this.mint(xuid) };
      }
      return {}; // mismatch -> tokenless, don't reveal which
    } catch (e) {
      // Auth is best-effort inside the players POST; never break registration.
      this.logger.warn(`registerOrReissue failed for ${xuid}: ${e}`);
      return {};
    }
  }

  // POST /auth/token — explicit re-auth (new install / token loss). Password must match.
  async issueToken(xuidRaw: string, password: string): Promise<{ token: string }> {
    const xuid = new Xuid(xuidRaw).value;
    const cred = await this.credentials.findOne({ xuid });
    if (!cred || !verifySecret(password, cred.passwordHash)) {
      throw new UnauthorizedException({ error: 'invalid_credentials' });
    }
    return { token: await this.mint(xuid) };
  }

  // POST /auth/recover — email-free reset: recovery code -> new password, rotate the recovery code, revoke
  // every existing token for the xuid.
  async recover(
    xuidRaw: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<{ ok: true; recoveryCode: string }> {
    const xuid = new Xuid(xuidRaw).value;
    const cred = await this.credentials.findOne({ xuid });
    if (!cred || !verifySecret(recoveryCode, cred.recoveryHash)) {
      throw new UnauthorizedException({ error: 'invalid_recovery_code' });
    }
    const rotated = newRecoveryCode();
    await this.credentials.updateOne(
      { xuid },
      {
        $set: {
          passwordHash: hashSecret(newPassword),
          recoveryHash: hashSecret(rotated),
        },
      },
    );
    await this.tokens.deleteMany({ xuid });
    return { ok: true, recoveryCode: rotated };
  }

  // POST /auth/revoke — logout: drop the presented token.
  async revoke(token: string): Promise<{ ok: true }> {
    if (token) await this.tokens.deleteOne({ tokenHash: hashToken(token) });
    return { ok: true };
  }

  // verifyToken resolves a bearer/query token to its xuid (or null). Used by the guard + the WS gateway.
  // Slides the token's lastUsedAt/expiresAt forward on success.
  async verifyToken(token: string): Promise<string | null> {
    if (!token) return null;
    const row = await this.tokens.findOne({ tokenHash: hashToken(token) });
    if (!row) return null;
    const now = Date.now();
    if (row.expiresAt.getTime() < now) {
      await this.tokens.deleteOne({ _id: row._id });
      return null;
    }
    await this.tokens.updateOne(
      { _id: row._id },
      {
        $set: {
          lastUsedAt: new Date(now),
          expiresAt: new Date(now + this.tokenTtlMs),
        },
      },
    );
    return row.xuid;
  }

  private async mint(xuid: string): Promise<string> {
    const token = newToken();
    const now = Date.now();
    await this.tokens.create({
      tokenHash: hashToken(token),
      xuid,
      createdAt: new Date(now),
      lastUsedAt: new Date(now),
      expiresAt: new Date(now + this.tokenTtlMs),
    });
    return token;
  }
}
