import { Controller, Post, Body, Res, HttpCode, Get } from '@nestjs/common';
import { Response } from 'express';
import { AgentService } from './agent.service';
import { AgentRequestDto } from './agent.dto';
import { McpRegistryService } from '../mcp/mcp-registry.service';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly mcpRegistry: McpRegistryService,
  ) {}

  /**
   * POST /api/v1/agent
   * Full ReAct agent run — RAG + tools + LLM loop. Returns when complete.
   */
  @Post()
  @HttpCode(200)
  async run(@Body() dto: AgentRequestDto) {
    return this.agentService.run(dto);
  }

  /**
   * POST /api/v1/agent/stream
   * Same as above but streams chunks as SSE while the agent is running.
   * Also emits tool_call and tool_result events so the UI can show what the agent is doing.
   */
  @Post('stream')
  async stream(@Body() dto: AgentRequestDto, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const event of this.agentService.runStream(dto)) {
        res.write(event);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
      res.end();
    }
  }

  /**
   * GET /api/v1/agent/tools
   * Lists all MCP tools currently registered and available to the agent.
   */
  @Get('tools')
  listTools() {
    return { tools: this.mcpRegistry.listTools() };
  }
}
