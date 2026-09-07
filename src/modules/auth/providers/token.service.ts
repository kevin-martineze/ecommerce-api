import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '@shared/config/env';
import { PrismaService } from '@db/prisma.service';

/** Lo que viaja dentro del access token. */
export interface AccessTokenPayload {
  /** Identificador de la cuenta. `sub` es el nombre estándar en JWT. */
  sub: string;
  email: string;
  /**
   * Tienda a la que está atado este token.
   *
   * Es la capa 2 del aislamiento: el guard rechaza la petición si este valor no
   * coincide con el `:storeId` del path. Un token de la tienda A no puede
   * siquiera nombrar a la tienda B. Cambiar de tienda emite un token nuevo, no
   * reinterpreta el que ya existe.
   */
  storeId: string | null;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Emite el par de tokens de una sesión.
   *
   * El refresh token es un valor aleatorio, no un JWT. Un JWT es válido por su
   * firma: para revocarlo antes de que expire hay que llevar igual una lista en
   * base de datos, así que la firma no aporta nada y sí obliga a decidir qué
   * hacer cuando la lista y el token se contradicen. Un valor opaco no tiene
   * esa ambigüedad: existe en la tabla o no vale.
   */
  async issue(
    userId: string,
    email: string,
    storeId: string | null,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    const payload: AccessTokenPayload = { sub: userId, email, storeId };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(32).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        storeId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        userAgent: context.userAgent ?? null,
        ip: context.ip ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
  }

  /**
   * Canjea un refresh token por una sesión nueva y anula el anterior.
   *
   * Rotación con detección de reuso: al canjearlo, el token viejo no se borra
   * sino que queda marcado apuntando al nuevo. Si alguien vuelve a presentar
   * uno ya canjeado, solo hay dos explicaciones —una copia robada, o un cliente
   * roto— y en ambas lo correcto es lo mismo: revocar TODA la cadena de esa
   * cuenta y obligar a entrar de nuevo. Sin esto, un refresh token robado sirve
   * para siempre y en silencio, porque el ladrón lo rota igual que el dueño.
   */
  async rotate(
    presentedToken: string,
    storeIdOverride?: string | null,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    const tokenHash = this.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
    }

    if (stored.rotatedToId !== null || stored.revokedAt !== null) {
      this.logger.warn(
        `Reuso de refresh token detectado para el usuario ${stored.userId}. Se revoca la cadena completa.`,
      );

      await this.revokeAllForUser(stored.userId);

      throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('La sesión expiró. Vuelve a entrar.');
    }

    const storeId = storeIdOverride === undefined ? stored.storeId : storeIdOverride;

    const issued = await this.issue(stored.userId, stored.user.email, storeId, context);

    const replacement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(issued.refreshToken) },
      select: { id: true },
    });

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { rotatedToId: replacement?.id ?? null, revokedAt: new Date() },
    });

    return issued;
  }

  /** Cierra una sesión concreta. No toca las demás sesiones de la cuenta. */
  async revoke(presentedToken: string): Promise<void> {
    const tokenHash = this.hashToken(presentedToken);

    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Cierra TODAS las sesiones de una cuenta. Cambio de contraseña, reuso detectado. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * SHA-256 y no argon2, deliberadamente.
   *
   * El refresh token son 32 bytes aleatorios: no hay diccionario que probar ni
   * contraseña que adivinar, así que el costo de argon2 no compraría nada y sí
   * se pagaría en cada refresh. Lo que hace falta acá es que la tabla no
   * contenga credenciales usables si alguien se lleva una copia, y para eso un
   * hash rápido de un valor de alta entropía alcanza.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    const ttl = this.config.get('JWT_REFRESH_TTL', { infer: true });

    return new Date(Date.now() + parseDuration(ttl) * 1000);
  }

  private accessTtlSeconds(): number {
    return parseDuration(this.config.get('JWT_ACCESS_TTL', { infer: true }));
  }
}

/**
 * Convierte `15m`, `30d`, `12h` o `45s` a segundos.
 *
 * Existe porque `@nestjs/jwt` acepta esas cadenas para firmar, pero la
 * respuesta necesita el mismo valor en segundos para que el cliente sepa cuándo
 * refrescar. Calcularlo dos veces con criterios distintos es como terminan
 * desincronizados.
 */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());

  if (!match) {
    throw new Error(`Duración inválida: "${value}". Usa formatos como 15m, 12h o 30d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const multiplier = multipliers[unit ?? 's'] ?? 1;

  return amount * multiplier;
}
