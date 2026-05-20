import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MemoryService } from './memory.service';
import { UpsertFactDto, UpsertEntityDto } from './memory.dto';

@Controller('memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  // ── Long-term facts ──────────────────────────────────────────────────────

  /** GET /memory/facts/:userId */
  @Get('facts/:userId')
  getFacts(@Param('userId') userId: string) {
    return this.memory.getFacts(userId);
  }

  /** POST /memory/facts — upsert a fact */
  @Post('facts')
  upsertFact(@Body() dto: UpsertFactDto) {
    return this.memory.upsertFact(
      dto.userId,
      dto.key,
      dto.value,
      'manual',
      dto.confidence ?? 1,
    );
  }

  /** DELETE /memory/facts/:userId/:key */
  @Delete('facts/:userId/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteFact(@Param('userId') userId: string, @Param('key') key: string) {
    return this.memory.deleteFact(userId, key);
  }

  /** DELETE /memory/facts/:userId — wipe all facts */
  @Delete('facts/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearFacts(@Param('userId') userId: string) {
    return this.memory.clearFacts(userId);
  }

  // ── Entity memory ────────────────────────────────────────────────────────

  /** GET /memory/entities/:userId?entityType=person */
  @Get('entities/:userId')
  getEntities(
    @Param('userId') userId: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.memory.getEntities(userId, entityType);
  }

  /** POST /memory/entities — upsert an entity */
  @Post('entities')
  upsertEntity(@Body() dto: UpsertEntityDto) {
    return this.memory.upsertEntity(
      dto.userId,
      dto.entityType,
      dto.name,
      dto.attributes,
      dto.mention,
    );
  }

  /** DELETE /memory/entities/:userId/:entityType/:name */
  @Delete('entities/:userId/:entityType/:name')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteEntity(
    @Param('userId') userId: string,
    @Param('entityType') entityType: string,
    @Param('name') name: string,
  ) {
    return this.memory.deleteEntity(userId, entityType, name);
  }

  /** DELETE /memory/entities/:userId — wipe all entities */
  @Delete('entities/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  clearEntities(@Param('userId') userId: string) {
    return this.memory.clearEntities(userId);
  }

  // ── Full context ─────────────────────────────────────────────────────────

  /** GET /memory/context/:userId — build formatted context fragment */
  @Get('context/:userId')
  getContext(@Param('userId') userId: string) {
    return this.memory.buildContext(userId);
  }

  /** DELETE /memory/:userId — wipe all memory for a user */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearAll(@Param('userId') userId: string) {
    await Promise.all([
      this.memory.clearFacts(userId),
      this.memory.clearEntities(userId),
    ]);
  }
}
