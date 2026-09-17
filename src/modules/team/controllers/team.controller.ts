import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { Roles } from '@shared/decorators/roles.decorator';
import { StoreRoute } from '@shared/decorators/store-route.decorator';
import {
  CreateInvitationDto,
  InvitationDto,
  MemberDto,
  UpdateMemberRoleDto,
} from '@shared/dtos/team/team.dto';

import { TeamService } from '../providers/team.service';

@ApiTags('equipo')
@StoreRoute()
@Controller('stores/:storeId')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('members')
  @ApiOperation({ summary: 'Quiénes administran la tienda.' })
  members(@Param('storeId') storeId: string): Promise<MemberDto[]> {
    return this.team.members(storeId);
  }

  @Patch('members/:userId')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Cambia el rol. La tienda nunca queda sin dueña.' })
  changeRole(
    @Param('storeId') storeId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<MemberDto[]> {
    return this.team.changeRole(storeId, userId, dto.role);
  }

  @Delete('members/:userId')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quita a alguien del equipo y cierra sus sesiones en esta tienda.' })
  async remove(
    @Param('storeId') storeId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.team.remove(storeId, userId);
  }

  @Get('invitations')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Invitaciones pendientes.' })
  invitations(@Param('storeId') storeId: string): Promise<InvitationDto[]> {
    return this.team.invitations(storeId);
  }

  @Post('invitations')
  @Roles('OWNER')
  @ApiOperation({ summary: 'Invita a un correo. Anula una invitación pendiente anterior.' })
  invite(
    @Param('storeId') storeId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationDto> {
    return this.team.invite(storeId, user.id, dto);
  }

  @Delete('invitations/:invitationId')
  @Roles('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Anula una invitación pendiente.' })
  async revokeInvitation(
    @Param('storeId') storeId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    await this.team.revokeInvitation(storeId, invitationId);
  }
}
