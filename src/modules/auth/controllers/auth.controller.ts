import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FastifyRequest } from 'fastify';
import { AuthenticatedUser, CurrentUser } from '@shared/decorators/current-user.decorator';
import { LoginDto } from '@shared/dtos/auth/login.dto';
import { RefreshDto, SwitchStoreDto } from '@shared/dtos/auth/refresh.dto';
import { RegisterStoreDto } from '@shared/dtos/auth/register-store.dto';
import { SessionResponseDto } from '@shared/dtos/auth/session-response.dto';
import { JwtAuthGuard } from '@shared/guards/jwt-auth.guard';

import { AuthService } from '../providers/auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Límite propio y agresivo.
   *
   * El techo global del throttler es holgado porque está pensado para el panel,
   * donde una sola persona dispara muchas peticiones. Estas rutas son otra
   * cosa: cada intento es una oportunidad de adivinar una credencial, y ninguna
   * persona real necesita diez por minuto.
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Crea una tienda y la cuenta de su dueña. Devuelve sesión iniciada.' })
  register(@Body() dto: RegisterStoreDto, @Req() req: FastifyRequest): Promise<SessionResponseDto> {
    return this.auth.registerStore(dto, contextOf(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Inicia sesión con correo y contraseña.' })
  login(@Body() dto: LoginDto, @Req() req: FastifyRequest): Promise<SessionResponseDto> {
    return this.auth.login(dto, contextOf(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Canjea el refresh token por una sesión nueva. El anterior queda anulado.',
  })
  refresh(@Body() dto: RefreshDto, @Req() req: FastifyRequest): Promise<SessionResponseDto> {
    return this.auth.refresh(dto.refreshToken, contextOf(req));
  }

  @Post('switch-store')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cambia la tienda activa. Emite una sesión nueva atada a la otra tienda.',
  })
  switchStore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SwitchStoreDto & RefreshDto,
    @Req() req: FastifyRequest,
  ): Promise<SessionResponseDto> {
    return this.auth.switchStore(user.id, dto.storeId, dto.refreshToken, contextOf(req));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Datos de la cuenta y tiendas donde es miembro.' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cierra esta sesión. Las otras sesiones de la cuenta siguen vivas.' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}

/**
 * Guarda de dónde vino la sesión, para que la dueña pueda reconocer una ajena.
 *
 * `req.ip` es la de verdad y no la del proxy porque el adaptador arranca con
 * `trustProxy`, que hace que Fastify lea `X-Forwarded-For`.
 */
function contextOf(req: FastifyRequest): { userAgent: string | null; ip: string | null } {
  const userAgent = req.headers['user-agent'];

  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 255) : null,
    ip: req.ip ?? null,
  };
}
