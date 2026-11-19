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
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { PlatformRoute } from '@shared/decorators/platform-route.decorator';
import {
  DeleteStoreDto,
  DeleteUserDto,
  PlatformUserDetailDto,
  PlatformUserDto,
  PlatformUserListQueryDto,
  UpdateUserStatusDto,
} from '@shared/dtos/platform/platform-users.dto';

import { PlatformUsersService } from '../providers/platform-users.service';

@ApiTags('plataforma')
@PlatformRoute()
@Controller('platform')
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsersService) {}

  @Get('users')
  @ApiOperation({ summary: 'Cuentas con sus tiendas y cómo entran. Hasta 200.' })
  list(@Query() query: PlatformUserListQueryDto): Promise<PlatformUserDto[]> {
    return this.users.listUsers(query);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Una cuenta, con las tiendas que se irían con ella.' })
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<PlatformUserDetailDto> {
    return this.users.getUser(userId);
  }

  @Patch('users/:userId/status')
  @ApiOperation({ summary: 'Deshabilita (y cierra sus sesiones) o reactiva una cuenta.' })
  setStatus(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<PlatformUserDetailDto> {
    return this.users.setDisabled(actor.id, userId, dto.disabled);
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Elimina la cuenta y las tiendas donde era la única dueña. No tiene vuelta atrás.',
  })
  deleteUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: DeleteUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    return this.users.deleteUser(actor.id, userId, dto);
  }

  @Delete('stores/:storeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Elimina una tienda suspendida con todo lo suyo. No tiene vuelta atrás.',
  })
  deleteStore(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: DeleteStoreDto,
  ): Promise<void> {
    return this.users.deleteStore(storeId, dto);
  }
}
