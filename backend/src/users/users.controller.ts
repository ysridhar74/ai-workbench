import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** List all enabled users with their persona config */
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  /** Get a single user with their full persona config */
  @Get(':userId')
  async findOne(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException(`User "${userId}" not found`);
    return user;
  }
}
