import { IsString, IsOptional, IsNumber, Min, Max, IsObject } from 'class-validator';

export class UpsertFactDto {
  @IsString()
  userId: string;

  @IsString()
  key: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class UpsertEntityDto {
  @IsString()
  userId: string;

  @IsString()
  entityType: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  mention?: string;
}

export class UserIdParamDto {
  @IsString()
  userId: string;
}
