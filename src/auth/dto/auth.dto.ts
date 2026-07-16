// POST /auth/token — explicit re-auth (new install / token loss).
export class TokenRequest {
  xuid: string;
  password: string;
}

// POST /auth/recover — email-free reset via the one-time recovery code.
export class RecoverRequest {
  xuid: string;
  recoveryCode: string;
  newPassword: string;
}
