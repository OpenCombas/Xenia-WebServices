import { Module } from '@nestjs/common';
import { EventsService } from './events.service';

// The push/registry core. A dependency-free leaf so both the party/friends services
// (which push events) and the gateway (which owns the sockets) share one instance.
@Module({
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
