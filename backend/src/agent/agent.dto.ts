import { IsString, IsNotEmpty, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class AgentMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class AgentRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  skill?: string;

  @IsArray()
  @IsOptional()
  history?: AgentMessageDto[];

  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  namespace?: string; // RAG knowledge base namespace to query

  @IsBoolean()
  @IsOptional()
  useRag?: boolean; // whether to include RAG context (default: true)

  @IsBoolean()
  @IsOptional()
  useTools?: boolean; // whether to enable MCP tools (default: true)
}
