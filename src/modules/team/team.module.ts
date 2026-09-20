import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';

import { TeamController } from './controllers/team.controller';
import { TeamService } from './providers/team.service';

/** El equipo de la tienda. Aceptar una invitación vive en `AuthModule`: es entrar a una cuenta. */
@Module({
  imports: [AuthModule],
  controllers: [TeamController],
  providers: [TeamService],
})
export class TeamModule {}
