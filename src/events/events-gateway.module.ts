import { Module } from '@nestjs/common';
import { EventsModule } from './events.module';
import { EventsGateway } from './events.gateway';
import { PartyModule } from '../party/party.module';
import { FriendsModule } from '../friends/friends.module';
import { AuthModule } from '../auth/auth.module';
import { TeardownModule } from '../teardown/teardown.module';

// Hosts the WebSocket gateway. Imports EventsModule (registry/push) + Party/Friends
// (for the connect snapshot + presence-interested set). This module is a leaf —
// nobody imports it — so there is no cycle with Party/Friends (which import only
// EventsModule to push events).
@Module({
  imports: [EventsModule, PartyModule, FriendsModule, AuthModule, TeardownModule],
  providers: [EventsGateway],
})
export class EventsGatewayModule {}
