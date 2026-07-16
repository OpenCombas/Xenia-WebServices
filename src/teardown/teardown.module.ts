import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { PersistanceModule } from 'src/infrastructure/persistance/persistance.module';
import { PartyModule } from 'src/party/party.module';
import { TeardownService } from './teardown.service';
import { GoodbyeController } from './goodbye.controller';

// Exit-time teardown: POST /goodbye + the shared TeardownService (also used by the WS-disconnect catch-all in
// the events gateway). CqrsModule for the session delete/reset commands; PersistanceModule for the xuid->MAC
// lookup; PartyModule to leave/dissolve the caller's party. Exports TeardownService for the gateway.
@Module({
  imports: [CqrsModule, PersistanceModule, PartyModule],
  controllers: [GoodbyeController],
  providers: [TeardownService],
  exports: [TeardownService],
})
export class TeardownModule {}
