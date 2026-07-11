import { Injectable } from '@nestjs/common';

@Injectable()
export default abstract class AbstractEnvSettings<T> {
  protected getFullConfig(): any {
    return {
      presentation: {
        port: parseInt(process.env.API_PORT),
      },
      persistance: {
        mongoURI: process.env.MONGO_URI ? process.env.MONGO_URI : '',
        swagger_API: process.env.SWAGGER_API
          ? process.env.SWAGGER_API
          : 'false',
        SSL: process.env.SSL ? process.env.SSL : 'false',
        nginx: process.env.nginx ? process.env.nginx : 'false',
        heroku_nginx: process.env.heroku_nginx
          ? process.env.heroku_nginx
          : 'false',
        xstorage: process.env.xstorage ? process.env.xstorage : 'false',
        HEROKU_RELEASE_CREATED_AT: process.env.HEROKU_RELEASE_CREATED_AT,
        HEROKU_BUILD_COMMIT: process.env.HEROKU_BUILD_COMMIT,
        START_TIME: new Date().toISOString(),
      },
      // Cloudflare Realtime TURN: short-lived STUN/TURN creds served to consoles via GET /turn. Unset
      // keyId/apiToken -> /turn returns an empty body and the client falls back to its own CVAR defaults.
      turn: {
        keyId: process.env.TURN_KEY_ID ? process.env.TURN_KEY_ID : '',
        apiToken: process.env.TURN_API_TOKEN ? process.env.TURN_API_TOKEN : '',
        ttl: process.env.TURN_TTL ? parseInt(process.env.TURN_TTL) : 3600,
      },
    };
  }

  public abstract get(): T;
}
