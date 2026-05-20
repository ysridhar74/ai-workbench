import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { EventEmitter } from 'events';
import { AppModule } from './app.module';

// Increase the global EventEmitter limit to prevent MaxListenersExceededWarning
// caused by LangGraph creating abort listeners on every agent invocation
EventEmitter.defaultMaxListeners = 50;

// Suppress OpenAI SDK warnings about Zod .optional() fields in MCP tool schemas.
// These come from @modelcontextprotocol/sdk generating optional input fields —
// not from our code — and do not affect tool calling behaviour with Ollama or LiteLLM.
const originalEmit = process.emit.bind(process);
(process as any).emit = (event: string, ...args: any[]) => {
  if (event === 'warning' && args[0]?.message?.includes('.optional()')) return false;
  return originalEmit(event, ...args);
};

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
