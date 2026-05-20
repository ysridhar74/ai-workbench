import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { RagSeederService } from './rag-seeder.service';

@Module({
  providers: [RagService, RagSeederService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
