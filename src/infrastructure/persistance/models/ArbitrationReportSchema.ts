import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ArbitrationReportDocument = ArbitrationReport & Document;

// One row per (session, arbitrated view, player) — the ledger that makes arbitrated stat delivery
// idempotent.
//
// WHY THIS EXISTS. Arbitrated stats are a CONSENSUS mechanism: on hardware every session member reports
// its view of every player's result, the service compares them, and the delta is applied only if the
// reports agree. Disagreement means the session was tampered with. Redundancy is the point, so Xenia
// deliberately submits arbitrated views from every console for every player.
//
// The leaderboard write path applies `sum` unconditionally (Leaderboard.update), so without this ledger an
// eight-player session would apply each arbitrated delta EIGHT times. Those columns feed games-played and
// the net win/loss record, and the same `sum` semantics rate the seasonal boards — so the error would
// compound per match and land hardest on the most active players, with no baseline to notice it against.
//
// POLICY: apply-once (option A). The FIRST report for a (session, view, player) is applied; later reports
// are compared against it and logged if they disagree, but never applied. That never double-counts and
// never discards a legitimate result when a member fails to report — which is routine (quit, drop, crash).
// True consensus (buffer all reports, apply only on unanimity) is stricter but would silently throw away a
// large fraction of real sessions. This keeps the tamper EVIDENCE (mismatches are logged) without acting on
// it, so tightening to unanimity later is a policy change rather than a rewrite.
//
// The unique index is what makes this correct under concurrency: several consoles report near-simultaneously,
// and insert-wins is an atomic claim. Do not replace it with a find-then-insert.
@Schema()
export class ArbitrationReport {
  @Prop({ required: true })
  sessionId: string;
  @Prop({ required: true })
  titleId: string;
  @Prop({ required: true })
  leaderboardId: string;
  @Prop({ required: true })
  player: string;
  // The stat values that were actually applied, kept so later reports can be compared against them.
  @Prop({ required: true, type: Object })
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  stats: Object;
  // Sessions are long finished well before this; the ledger only needs to outlive the reporting window.
  @Prop({ type: Date, expires: '7d', default: Date.now, required: true })
  createdAt: Date;
}

export const ArbitrationReportSchema =
  SchemaFactory.createForClass(ArbitrationReport);

ArbitrationReportSchema.index(
  { sessionId: 1, titleId: 1, leaderboardId: 1, player: 1 },
  { unique: true },
);
