import {
  Controller, Post, Body, Get, Query, Delete,
  HttpCode, BadRequestException,
} from '@nestjs/common';
import { RagService } from './rag.service';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

class IngestTextDto {
  @IsString() @IsNotEmpty() text: string;
  @IsString() @IsNotEmpty() source: string;
  @IsString() @IsOptional() namespace?: string;
}

class RetrieveDto {
  @IsString() @IsNotEmpty() query: string;
  @IsString() @IsOptional() namespace?: string;
}

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * POST /api/v1/rag/ingest/text
   * Ingest plain text directly.
   */
  @Post('ingest/text')
  @HttpCode(200)
  async ingestText(@Body() dto: IngestTextDto) {
    const result = await this.ragService.ingestText(dto.text, {
      source: dto.source,
      namespace: dto.namespace ?? 'default',
    });
    return result;
  }

  /**
   * POST /api/v1/rag/retrieve
   * Retrieve relevant chunks for a query string.
   */
  @Post('retrieve')
  @HttpCode(200)
  async retrieve(@Body() dto: RetrieveDto) {
    const results = await this.ragService.retrieveWithScores(dto.query, {
      namespace: dto.namespace ?? 'default',
      topK: 4,
    });
    return {
      query: dto.query,
      namespace: dto.namespace ?? 'default',
      results: results.map(([doc, score]) => ({
        text: doc.pageContent,
        score: Math.round(score * 1000) / 1000,
        metadata: doc.metadata,
      })),
    };
  }

  /**
   * DELETE /api/v1/rag/source?source=...&namespace=...
   * Remove all chunks for a given source document.
   */
  @Delete('source')
  @HttpCode(200)
  async deleteSource(
    @Query('source') source: string,
    @Query('namespace') namespace = 'default',
  ) {
    if (!source) throw new BadRequestException('source query param is required');
    await this.ragService.deleteSource(source, namespace);
    return { deleted: true, source, namespace };
  }
}
