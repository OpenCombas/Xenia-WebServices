import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import {
  Friendship,
  FriendshipSchema,
} from './schemas/friendship.schema';
import { PersistanceModule } from 'src/infrastructure/persistance/persistance.module';
import { EventsModule } from '../events/events.module';

// Standalone server-owned friends service. Owns its own `friendships` collection;
// imports PersistanceModule (IPlayerRepository for gamertag/presence + gamertag->xuid)
// and EventsModule (push friend.* events + read WS connection-liveness for `online`).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Friendship.name, schema: FriendshipSchema },
    ]),
    PersistanceModule,
    EventsModule,
  ],
  controllers: [FriendsController],
  providers: [FriendsService],
})
export class FriendsModule {}
