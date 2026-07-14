import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PartyController } from './party.controller';
import { PartyService } from './party.service';
import { Party, PartySchema } from './schemas/party.schema';
import {
  PartyInvite,
  PartyInviteSchema,
} from './schemas/party-invite.schema';
import { PersistanceModule } from 'src/infrastructure/persistance/persistance.module';

// Standalone party/voice-roster service. Owns its own `parties` + `partyInvites`
// collections; imports PersistanceModule only to reuse IPlayerRepository for
// gamertag + console-MAC (peer_key) enrichment from the login-time Players record.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Party.name, schema: PartySchema },
      { name: PartyInvite.name, schema: PartyInviteSchema },
    ]),
    PersistanceModule,
  ],
  controllers: [PartyController],
  providers: [PartyService],
})
export class PartyModule {}
