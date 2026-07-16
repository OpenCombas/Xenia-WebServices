import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { Credential, CredentialSchema } from './schemas/credential.schema';
import { AuthToken, AuthTokenSchema } from './schemas/auth-token.schema';

// Email-free auth: a client-generated device-secret ("password") claims an xuid (TOFU) and mints revocable
// opaque bearer tokens. The claim/re-issue path is folded into POST /players (see PlayerController);
// /auth/token|recover|revoke are the explicit re-auth paths. Exports AuthService (players handler + WS
// gateway resolve tokens) + AuthGuard (Phase-1 route enforcement). See adr-0002-authentication.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Credential.name, schema: CredentialSchema },
      { name: AuthToken.name, schema: AuthTokenSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
