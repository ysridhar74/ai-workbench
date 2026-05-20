import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  LongTermMemory,
  LongTermMemorySchema,
} from '../db/schemas/long-term-memory.schema';
import {
  EntityMemory,
  EntityMemorySchema,
} from '../db/schemas/entity-memory.schema';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LongTermMemory.name, schema: LongTermMemorySchema },
      { name: EntityMemory.name, schema: EntityMemorySchema },
    ]),
  ],
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
