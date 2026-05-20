import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  role: 'user' | 'assistant';

  @IsString()
  @IsNotEmpty()
  content: string;
}

export class ChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsString()
  @IsOptional()
  skill?: string;

  @IsArray()
  @IsOptional()
  history?: ChatMessageDto[];

  @IsString()
  @IsOptional()
  userId?: string;
}
