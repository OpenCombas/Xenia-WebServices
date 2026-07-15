import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RecentController } from './recent.controller';
import { RecentService } from './recent.service';
import {
  RecentEncounter,
  RecentEncounterSchema,
} from './schemas/recent.schema';
import { PersistanceModule } from 'src/infrastructure/persistance/persistance.module';
import { EventsModule } from '../events/events.module';

// Standalone server-owned "recent players" service. Owns its own `recentencounters` collection; imports
// PersistanceModule (IPlayerRepository for gamertag enrichment) and EventsModule (WS liveness for the
// `online` flag). Exports RecentService so the session-join handler can capture encounters.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RecentEncounter.name, schema: RecentEncounterSchema },
    ]),
    PersistanceModule,
    EventsModule,
  ],
  controllers: [RecentController],
  providers: [RecentService],
  exports: [RecentService],
})
export class RecentModule {}
