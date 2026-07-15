import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

// Standalone, stateless log-upload proxy. No persistence, no other-module deps — it only streams uploads
// through to the external ingest backend (LOG_BACKEND_URL). Config is env: LOGS_ENABLED, LOG_BACKEND_URL,
// LOG_BACKEND_TOKEN, LOG_MAX_MB, LOG_RATE_MAX, LOG_RATE_WINDOW_MS.
@Module({
  controllers: [LogsController],
  providers: [LogsService],
})
export class LogsModule {}
