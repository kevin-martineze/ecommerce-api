import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '@db/prisma.service';

/**
 * Sondas de salud.
 *
 * Son dos y no una porque responden preguntas distintas, y confundirlas causa
 * caídas evitables:
 *
 * - `/health` (liveness): ¿el proceso está vivo? No toca la base. Si esta
 *   sonda consultara Postgres, una caída momentánea de la base haría que el
 *   orquestador matara y reiniciara todos los contenedores sanos, justo cuando
 *   lo último que hace falta es una tormenta de reinicios.
 *
 * - `/health/ready` (readiness): ¿puede atender tráfico? Sí toca la base. Si
 *   falla, el balanceador deja de mandarle peticiones pero NO lo reinicia, que
 *   es la reacción correcta mientras la base vuelve.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness: el proceso responde. No consulta la base.' })
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: Math.floor(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: hay conexión con Postgres.' })
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`select 1`;
    } catch {
      // El detalle del fallo ya lo registró el filtro global; hacia afuera solo
      // interesa el sí/no, porque esta ruta la consume un balanceador.
      throw new ServiceUnavailableException('Sin conexión con la base de datos.');
    }

    return { status: 'ok', database: 'up' };
  }
}
