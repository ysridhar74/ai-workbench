import {
  Controller, Post, Body, Get, Query, Delete,
  HttpCode, BadRequestException,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RagService } from './rag.service';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

class IngestTextDto {
  @IsString() @IsNotEmpty() text: string;
  @IsString() @IsNotEmpty() source: string;
  @IsString() @IsOptional() namespace?: string;
}

class IngestUrlDto {
  @IsString() @IsNotEmpty() url: string;
  @IsString() @IsOptional() namespace?: string;
}

class RetrieveDto {
  @IsString() @IsNotEmpty() query: string;
  @IsString() @IsOptional() namespace?: string;
}

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  // ── Ingest endpoints ────────────────────────────────────────────────────

  /**
   * POST /api/v1/rag/ingest/text
   * Ingest plain text directly.
   */
  @Post('ingest/text')
  @HttpCode(200)
  async ingestText(@Body() dto: IngestTextDto) {
    return this.ragService.ingestText(dto.text, {
      source: dto.source,
      namespace: dto.namespace ?? 'default',
    });
  }

  /**
   * POST /api/v1/rag/ingest/file
   * Upload a PDF, DOCX, or TXT file — multipart/form-data.
   * Form fields: file (required), namespace (optional, default: "default")
   *
   * curl -X POST .../rag/ingest/file \
   *   -F "file=@report.pdf" -F "namespace=finance"
   */
  @Post('ingest/file')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async ingestFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('namespace') namespace?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const meta = {
      source: file.originalname,
      namespace: namespace ?? 'default',
      mimeType: file.mimetype,
    };

    if (ext === 'pdf' || file.mimetype === 'application/pdf') {
      return this.ragService.ingestPdf(file.buffer, meta);
    }

    if (
      ext === 'docx' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return this.ragService.ingestDocx(file.buffer, meta);
    }

    if (ext === 'txt' || file.mimetype === 'text/plain') {
      return this.ragService.ingestText(file.buffer.toString('utf-8'), meta);
    }

    throw new BadRequestException(
      `Unsupported file type "${ext}". Supported: pdf, docx, txt`,
    );
  }

  /**
   * POST /api/v1/rag/ingest/url
   * Fetch a web page and ingest its text content.
   * Body: { url, namespace? }
   */
  @Post('ingest/url')
  @HttpCode(200)
  async ingestUrl(@Body() dto: IngestUrlDto) {
    return this.ragService.ingestUrl(dto.url, {
      namespace: dto.namespace ?? 'default',
    });
  }

  // ── Retrieve ────────────────────────────────────────────────────────────

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

  // ── Listing ─────────────────────────────────────────────────────────────

  /**
   * GET /api/v1/rag/namespaces
   * List all distinct namespaces that have ingested content.
   */
  @Get('namespaces')
  async listNamespaces() {
    const namespaces = await this.ragService.listNamespaces();
    return { namespaces };
  }

  /**
   * GET /api/v1/rag/sources?namespace=default
   * List all ingested source documents in a namespace.
   */
  @Get('sources')
  async listSources(@Query('namespace') namespace = 'default') {
    const sources = await this.ragService.listSources(namespace);
    return { namespace, sources };
  }

  // ── Delete ──────────────────────────────────────────────────────────────

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
