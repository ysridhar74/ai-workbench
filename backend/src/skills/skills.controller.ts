import { Controller, Get, Post, Body, Param, Patch, HttpCode } from '@nestjs/common';
import { SkillsService, CreateSkillDto } from './skills.service';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  /** List all enabled skills */
  @Get()
  async list() {
    const skills = await this.skillsService.findAll();
    return { skills };
  }

  /** List all skills including disabled */
  @Get('all')
  async listAll() {
    const skills = await this.skillsService.findAll(false);
    return { skills };
  }

  /** Get a single skill by name */
  @Get(':name')
  async getOne(@Param('name') name: string) {
    const skill = await this.skillsService.findByName(name);
    return { skill };
  }

  /** Register a new skill */
  @Post()
  async create(@Body() dto: CreateSkillDto) {
    const skill = await this.skillsService.create(dto);
    return { skill };
  }

  /** Update an existing skill */
  @Patch(':name')
  async update(@Param('name') name: string, @Body() dto: Partial<CreateSkillDto>) {
    const skill = await this.skillsService.update(name, dto);
    return { skill };
  }

  /** Disable a skill (soft delete) */
  @Post(':name/disable')
  @HttpCode(204)
  async disable(@Param('name') name: string) {
    await this.skillsService.disable(name);
  }
}
