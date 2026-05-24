import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../db/schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

const SEED_USERS = [
  {
    userId: 'user-broker-1',
    name: 'Sarah Mitchell',
    email: 'sarah.mitchell@company.com',
    persona: 'broker' as const,
    enabled: true,
  },
  {
    userId: 'user-underwriter-1',
    name: 'James Thornton',
    email: 'james.thornton@company.com',
    persona: 'underwriter' as const,
    enabled: true,
  },
  {
    userId: 'user-claims-1',
    name: 'Priya Nair',
    email: 'priya.nair@company.com',
    persona: 'claims' as const,
    enabled: true,
  },
];

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [UsersService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule implements OnModuleInit {
  private readonly logger = new Logger(UsersModule.name);

  constructor(private readonly usersService: UsersService) {}

  async onModuleInit() {
    for (const user of SEED_USERS) {
      await this.usersService.upsert(user);
    }
    this.logger.log(`User registry ready — ${SEED_USERS.length} user(s) seeded`);
  }
}
