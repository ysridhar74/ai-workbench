import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * On first boot, ingests all .txt files from the sample-docs/ folder
 * into the default RAG namespace. Skips if already ingested.
 * Set RAG_SEED_DOCS=false to disable.
 */
@Injectable()
export class RagSeederService implements OnModuleInit {
  private readonly logger = new Logger(RagSeederService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('RAG_SEED_DOCS') === 'false') return;

    const docsDir = path.join(process.cwd(), 'sample-docs');
    if (!fs.existsSync(docsDir)) return;

    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.txt'));
    if (files.length === 0) return;

    this.logger.log(`Seeding ${files.length} sample document(s) into RAG...`);

    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(docsDir, file), 'utf-8');
        const result = await this.ragService.ingestText(text, {
          source: file,
          namespace: 'default',
          type: 'sample',
        });
        this.logger.log(`  ✓ ${file} → ${result.chunksCreated} chunks`);
      } catch (err) {
        this.logger.warn(`  ✗ ${file}: ${err.message}`);
      }
    }
  }
}
