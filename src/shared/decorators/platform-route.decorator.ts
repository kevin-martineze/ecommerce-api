import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@shared/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '@shared/guards/platform-admin.guard';

/** Marca un controlador como parte de `/platform/*`: identidad y luego administrador de la plataforma. */
export function PlatformRoute() {
  return applyDecorators(UseGuards(JwtAuthGuard, PlatformAdminGuard), ApiBearerAuth());
}
