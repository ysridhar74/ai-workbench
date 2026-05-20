import { Controller, Post, Body, Res, HttpCode } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * POST /api/v1/chat
   * Standard (non-streaming) response — returns the full answer in one JSON payload.
   *
   * Body: { message, skill?, history?, userId? }
   */
  @Post()
  @HttpCode(200)
  async chat(@Body() dto: ChatRequestDto) {
    const result = await this.chatService.chat(dto);
    return result;
  }

  /**
   * POST /api/v1/chat/stream
   * Server-Sent Events stream — sends chunks as they arrive from the LLM.
   * Each event is: data: { type: "chunk" | "done" | "[DONE]", ... }
   *
   * Final "done" event includes token counts and cost.
   */
  @Post('stream')
  async stream(@Body() dto: ChatRequestDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    try {
      for await (const event of this.chatService.chatStream(dto)) {
        res.write(event);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
