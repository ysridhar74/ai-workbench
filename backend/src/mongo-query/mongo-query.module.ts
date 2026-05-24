import { Module } from '@nestjs/common';
import { MongoQueryService } from './mongo-query.service';

@Module({
  providers: [MongoQueryService],
  exports: [MongoQueryService],
})
export class MongoQueryModule {}
