// ── Noise suppression — must run before any imports that trigger warnings ──
// The OpenAI SDK warns about Zod .optional() fields in MCP tool schemas via
// console.warn. These originate from @modelcontextprotocol/sdk internals and
// do not affect tool calling. Filter them out so the console stays readable.
const _warn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  const msg = args[0];
  if (typeof msg === 'string' && msg.includes('.optional()') && msg.includes('nullable')) return;
  _warn(...args);
};

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { EventEmitter } from 'events';
import { AppModule } from './app.module';

// Increase the global EventEmitter limit to prevent MaxListenersExceededWarning
// caused by LangGraph creating abort listeners on every agent invocation
EventEmitter.defaultMaxListeners = 50;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for web frontend and desktop shell
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`\n🚀 AI Workbench backend running on http://localhost:${port}/api/v1`);
  console.log(`   LLM model : ${process.env.LLM_MODEL || 'not set'}`);
  console.log(`   LangSmith : ${process.env.LANGCHAIN_TRACING_V2 === 'true' ? 'enabled' : 'disabled'}\n`);
}

bootstrap();
