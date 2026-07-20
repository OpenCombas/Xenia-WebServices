import {
  ConsoleLogger,
  Controller,
  Get,
  Header,
  Param,
  Res,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiParam, ApiTags } from '@nestjs/swagger';
import { join } from 'path';
import { Response } from 'express';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { createHash } from 'crypto';

@ApiTags('Title')
@Controller('/title/:titleId')
export class TitleController {
  constructor(
    private readonly logger: ConsoleLogger,
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {
    this.logger.setContext(TitleController.name);
  }

  @Get('/servers')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @Header('content-type', 'application/json')
  async getTitleServers(
    @Param('titleId') titleId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const path = join(
      process.cwd(),
      './src/titles',
      titleId.toUpperCase(),
      'servers.json',
    );

    if (!existsSync(path)) {
      return [];
    }

    const stats = await stat(path);

    res.set('Content-Length', stats.size.toString());

    const file = await readFile(path);

    return file.toString('utf8');
  }

  @Get('/services')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @Header('content-type', 'application/json')
  async getTitleService(
    @Param('titleId') titleId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const path = join(
      process.cwd(),
      './src/titles',
      titleId.toUpperCase(),
      'services.json',
    );

    if (!existsSync(path)) {
      return [];
    }

    const stats = await stat(path);

    res.set('Content-Length', stats.size.toString());

    const file = await readFile(path);

    return file.toString('utf8');
  }

  // XLAST (matchmaking query/attribute definitions) for titles whose SPA does not embed one.
  //
  // GameInfoDatabase::Init loads two sources: the compiled SPA, and XLAST XML compressed INSIDE it via
  // SpaInfo::ReadXLast. ChromeHounds (534507D4) ships the SPA -- 278 stats views, so leaderboards,
  // contexts, properties and achievements are all declared by the title -- but NO XLAST, so
  // GetQueryData() returns an empty Query for every id and matchmaking has no definition at all. Xenia
  // has been logging exactly that for weeks: "Title doesn't contain XLAST data! Multiplayer
  // functionality might be limited."
  //
  // Serving it here rather than shipping a file with the client makes the server the source of truth: a
  // corrected XLAST reaches every client on its next title load, with no redistribution.
  //
  // RAW XML, not gzipped. Xenia inflates the SPA-embedded copy with gzip (`16 + MAX_WBITS`), so a
  // compressed file would also work -- but the whole point of an external XLAST is that it is editable
  // and diffable. Compression belongs on the wire (Content-Encoding), not in the source of truth.
  //
  // The file must contain ONLY what the SPA does not already declare. Anything restated here becomes a
  // second source of truth that can silently disagree with the binary.
  @Get('/xlast')
  @ApiParam({ name: 'titleId', example: '534507D4' })
  @Header('content-type', 'application/xml')
  async getTitleXLast(
    @Param('titleId') titleId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const path = join(
      process.cwd(),
      './src/titles',
      titleId.toUpperCase(),
      'xlast.xml',
    );

    // 404 rather than the empty-body convention the sibling routes use: the client must be able to tell
    // "server reachable, this title has no XLAST" from "server unreachable", because those degrade to the
    // same behaviour but mean different things when someone is diagnosing matchmaking.
    if (!existsSync(path)) {
      res.status(404);
      return '';
    }

    // ⚠ SAFETY GATE -- READ BEFORE ENABLING.
    //
    // In Xenia today, HasXLast() == true does NOT switch session search to XLAST-driven filtering. It
    // DISABLES FILTERING ALTOGETHER: the hand-written filters are gated on !HasXLast() (xsession.cc:1515,
    // :1523) and the HasXLast() branch (:1804) reads the parameters/filters/returns and then never uses
    // them -- it only logs. The XLAST parser does not even read the `op` attribute, so no comparison is
    // expressible there.
    //
    // So merely PLACING an xlast.xml in a title directory would make every client stop filtering session
    // search and list every session on the server -- reintroducing the cross-squad and parallel-lobby
    // results that took weeks to eliminate. The file existing is the whole trigger; no deploy required.
    //
    // The gate exists so the file can be authored, reviewed and committed WITHOUT arming that. Enabling is
    // then a single deliberate act, and only correct once the client no longer gates its filters on
    // HasXLast(). Logged unconditionally so "why is my XLAST not being served" is never a mystery.
    if (process.env.XLAST_SERVE_ENABLED !== 'true') {
      this.logger.warn(
        `XLAST present for ${titleId.toUpperCase()} but NOT served: XLAST_SERVE_ENABLED is not 'true'. ` +
          `Serving it would disable session-search filtering in Xenia (HasXLast() skips the filter path). ` +
          `Enable only after the client stops gating its filters on HasXLast().`,
      );
      res.status(404);
      return '';
    }

    const file = await readFile(path);
    const stats = await stat(path);

    // Served so a client can adopt conditional requests later without a server change. Content-hashed
    // rather than mtime-based so a redeploy that rewrites timestamps does not invalidate every cache.
    const etag = `"${createHash('sha256').update(file).digest('hex').slice(0, 32)}"`;
    res.set('ETag', etag);

    if (res.req.headers['if-none-match'] === etag) {
      res.status(304);
      return '';
    }

    res.set('Content-Length', stats.size.toString());
    return file.toString('utf8');
  }

  @Get('/ports')
  @ApiParam({ name: 'titleId', example: '4D5307E6' })
  @Header('content-type', 'application/json')
  async getTitlePorts(
    @Param('titleId') titleId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const path = join(
      process.cwd(),
      './src/titles',
      titleId.toUpperCase(),
      'ports.json',
    );

    if (!existsSync(path)) {
      return {};
    }

    const stats = await stat(path);

    res.set('Content-Length', stats.size.toString());

    const file = await readFile(path);

    return file.toString('utf8');
  }
}
