import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  InvitationPreviewDto,
  ResetPasswordDto,
} from '@shared/dtos/auth/account.dto';
import { SessionResponseDto } from '@shared/dtos/auth/session-response.dto';
import { Mailer } from '@shared/mail/mailer';
import { passwordResetMail } from '@shared/mail/templates';
import { hashSecret, newSecret } from '@shared/utils/secrets';
import { PrismaService } from '@db/prisma.service';

import { AuthService, RequestContext } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/** Vida del enlace de recuperación. Corto: viaja por correo, que no es un canal seguro. */
const RESET_TTL_MINUTES = 60;

const INVALID_RESET = 'El enlace no es válido o ya venció. Pide uno nuevo.';
const INVALID_INVITATION = 'La invitación no es válida, ya se usó o venció.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La cuenta: recuperar y cambiar la contraseña, y aceptar invitaciones.
 *
 * Aparte de `AuthService` porque no inicia sesiones con credenciales: cambia
 * lo que las respalda.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Manda el enlace para fijar una contraseña nueva.
   *
   * Responde igual exista o no la cuenta, y el correo sale sin esperar: si se
   * esperara, una cuenta real tardaría lo que tarda el SMTP y una inexistente
   * nada, y el cronómetro volvería a enumerar cuentas.
   */
  async forgotPassword(email: string, context: RequestContext = {}): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true },
    });

    if (!user) {
      return;
    }

    const secret = newSecret();

    await this.prisma.withTransaction(async (tx) => {
      // Solo sirve el último enlace pedido: los anteriores dejan de valer.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(secret),
          expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
          ip: context.ip ?? null,
        },
      });
    });

    const url = `${this.config.get('FRONTEND_URL', { infer: true })}/admin/restablecer?token=${secret}`;

    this.mailer
      .send(passwordResetMail(user.email, url, RESET_TTL_MINUTES))
      .catch((error: unknown) => {
        this.logger.error(
          `No se pudo enviar el correo de recuperación: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Fija la contraseña nueva y cierra todas las sesiones de la cuenta.
   *
   * Cerrarlas es el punto: quien recupera la contraseña suele hacerlo porque
   * alguien más entró. También levanta el bloqueo por intentos fallidos.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashSecret(dto.token);
    const passwordHash = await this.passwords.hash(dto.password);

    const userId = await this.prisma.withTransaction(async (tx) => {
      // Marcar como usado en la misma sentencia que lo comprueba: dos envíos
      // simultáneos del mismo enlace no pueden pasar los dos.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new BadRequestException(INVALID_RESET);
      }

      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });

      if (!token) {
        throw new BadRequestException(INVALID_RESET);
      }

      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });

      return token.userId;
    });

    await this.tokens.revokeAllForUser(userId);
  }

  /** Cambia la contraseña conociendo la actual. Esta sesión sigue; las demás se cierran. */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (
      !user?.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, dto.currentPassword))
    ) {
      throw new UnauthorizedException('La contraseña actual no es correcta.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('La contraseña nueva tiene que ser distinta de la actual.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });

    await this.tokens.revokeAllForUser(userId, dto.refreshToken);
  }

  /** Lo que muestra el enlace de invitación antes de aceptarla. */
  async previewInvitation(token: string): Promise<InvitationPreviewDto> {
    const found = await this.findPendingInvitation(token);

    if (!found) {
      throw new NotFoundException(INVALID_INVITATION);
    }

    const account = await this.prisma.user.findUnique({
      where: { email: found.invitation.email },
      select: { passwordHash: true },
    });

    return {
      storeName: found.store.name,
      storeSlug: found.store.slug,
      email: found.invitation.email,
      role: found.invitation.role,
      accountExists: !!account?.passwordHash,
      expiresAt: found.invitation.expiresAt,
    };
  }

  /**
   * Acepta la invitación y devuelve una sesión ya en esa tienda.
   *
   * Con cuenta existente se exige su contraseña (y cuenta como un intento de
   * login, con su bloqueo): el enlace prueba acceso al correo, no a la cuenta.
   * Sin cuenta, se crea con la contraseña que se elige aquí.
   */
  async acceptInvitation(
    dto: AcceptInvitationDto,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    const found = await this.findPendingInvitation(dto.token);

    if (!found) {
      throw new BadRequestException(INVALID_INVITATION);
    }

    const { invitation, store } = found;
    const existing = await this.prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true, passwordHash: true },
    });

    let existingUserId: string | null = null;
    let newAccount: { fullName: string; passwordHash: string } | null = null;

    if (existing?.passwordHash) {
      // Reusa el login entero: bloqueo, rehash de bcrypt, mismos mensajes.
      const session = await this.auth.login(
        { email: invitation.email, password: dto.password },
        context,
      );

      await this.auth.logout(session.refreshToken);
      existingUserId = existing.id;
    } else {
      if (!dto.fullName) {
        throw new BadRequestException('Escribe tu nombre.');
      }

      if (dto.password.length < 12) {
        throw new BadRequestException('La contraseña necesita al menos 12 caracteres.');
      }

      newAccount = {
        fullName: dto.fullName,
        passwordHash: await this.passwords.hash(dto.password),
      };
    }

    // Cuenta nueva, invitación usada y membresía: todo o nada. Una invitación
    // que otra pestaña aceptó un instante antes no deja una cuenta suelta.
    const userId = await this.prisma.withTransaction(async (tx) => {
      let id = existingUserId;

      if (newAccount) {
        const user = existing
          ? await tx.user.update({ where: { id: existing.id }, data: newAccount })
          : await tx.user.create({ data: { email: invitation.email, ...newAccount } });

        id = user.id;
      }

      if (!id) {
        throw new BadRequestException(INVALID_INVITATION);
      }

      await this.prisma.setStoreContext(tx, store.id);

      const claimed = await tx.storeInvitation.updateMany({
        where: {
          id: invitation.id,
          storeId: store.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new BadRequestException(INVALID_INVITATION);
      }

      // Ya miembro (la invitaron dos veces): se respeta el rol que tenía.
      await tx.storeMember.upsert({
        where: { storeId_userId: { storeId: store.id, userId: id } },
        create: { storeId: store.id, userId: id, role: invitation.role },
        update: {},
      });

      return id;
    });

    return this.auth.sessionFor(userId, store.id, context);
  }

  private async findPendingInvitation(token: string) {
    const [storeId, secret] = token.split('.');

    if (!storeId || !secret || !UUID.test(storeId)) {
      return null;
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, slug: true, status: true },
    });

    if (!store || store.status === 'SUSPENDED') {
      return null;
    }

    const invitation = await this.prisma.forStore(storeId, (tx) =>
      tx.storeInvitation.findFirst({
        where: {
          storeId,
          tokenHash: hashSecret(secret),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
    );

    return invitation ? { invitation, store } : null;
  }
}
