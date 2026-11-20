import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  SetPasswordDto,
  UnlinkGoogleDto,
} from '@shared/dtos/auth/account.dto';
import { GoogleAcceptInvitationDto } from '@shared/dtos/auth/google.dto';
import { SessionResponseDto } from '@shared/dtos/auth/session-response.dto';
import { Mailer, MailMessage } from '@shared/mail/mailer';
import { googleUnlinkedMail, passwordCreatedMail, passwordResetMail } from '@shared/mail/templates';
import { hashSecret, newSecret } from '@shared/utils/secrets';
import { PrismaService, TenantClient } from '@db/prisma.service';
import { NotificationsService } from '@modules/notifications/providers/notifications.service';

import { AuthService, GOOGLE, GoogleLink, RequestContext } from './auth.service';
import { GoogleAuthService, GoogleProfile } from './google-auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/** Vida del enlace de recuperación. Corto: viaja por correo, que no es un canal seguro. */
const RESET_TTL_MINUTES = 60;

const INVALID_RESET = 'El enlace no es válido o ya venció. Pide uno nuevo.';
const INVALID_INVITATION = 'La invitación no es válida, ya se usó o venció.';
const INVALID_SESSION = 'La sesión no es válida. Vuelve a entrar.';

/** Una cuenta que ya tiene contraseña no la vuelve a fijar: para cambiarla, `changePassword`. */
const PASSWORD_ALREADY_SET = {
  message: 'Tu cuenta ya tiene contraseña. Para cambiarla, usa cambiar contraseña.',
  error: 'password_already_set',
};

/** Desconectar Google sin contraseña dejaría la cuenta sin forma de entrar. */
const PASSWORD_REQUIRED = {
  message: 'Crea una contraseña antes de desconectar Google: si no, no podrías entrar.',
  error: 'password_required',
};

const GOOGLE_NOT_LINKED = {
  message: 'Esta cuenta no tiene Google conectado.',
  error: 'google_not_linked',
};

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
    private readonly google: GoogleAuthService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
    private readonly notifications: NotificationsService,
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
      select: { id: true, email: true, disabledAt: true },
    });

    // Una cuenta deshabilitada recibe la misma respuesta que una inexistente:
    // el enlace no le serviría para entrar y decirlo revelaría el estado.
    if (!user || user.disabledAt) {
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

      // El enlace llegó al correo: la cuenta acaba de probar que es suyo.
      await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
          emailVerifiedAt: new Date(),
        },
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

  /**
   * Crea la contraseña de una cuenta que entra solo con Google. No pide la
   * actual porque no existe: quien tiene sesión ya probó la cuenta con Google.
   *
   * El `UPDATE` lleva `passwordHash: null` en el `where`: si otra pestaña acaba
   * de fijar una, esta no la pisa y responde igual que si la hubiera visto antes.
   */
  async setPassword(userId: string, dto: SetPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_SESSION);
    }

    if (user.passwordHash !== null) {
      throw new ConflictException(PASSWORD_ALREADY_SET);
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: null },
      data: { passwordHash },
    });

    if (claimed.count === 0) {
      throw new ConflictException(PASSWORD_ALREADY_SET);
    }

    await this.tokens.revokeAllForUser(userId, dto.refreshToken);

    this.notify(
      passwordCreatedMail(user.email, this.accountUrl()),
      'el aviso de contraseña creada',
    );
  }

  /**
   * Desconecta Google de la cuenta. Sin contraseña, la cuenta se quedaría sin
   * forma de entrar, así que se exige crear una antes.
   *
   * La comprobación y el borrado van en UNA transacción, con la fila de la
   * cuenta bloqueada (`for update`). Así `setPassword` o un vínculo nuevo que
   * llegan a la vez esperan a que esta decisión termine, y nadie decide con un
   * estado que otra petición está cambiando.
   *
   * Las demás sesiones se cierran después, cuando el borrado ya es real. La de
   * `refreshToken` sigue viva: es la que hizo el cambio.
   */
  async unlinkGoogle(userId: string, dto: UnlinkGoogleDto): Promise<void> {
    const email = await this.prisma.withTransaction(async (tx) => {
      await tx.$queryRaw`select id from users where id = ${userId}::uuid for update`;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true, passwordHash: true },
      });

      if (!user) {
        throw new UnauthorizedException(INVALID_SESSION);
      }

      const linked = await tx.userIdentity.count({ where: { userId, provider: GOOGLE } });

      if (linked === 0) {
        throw new NotFoundException(GOOGLE_NOT_LINKED);
      }

      if (user.passwordHash === null) {
        throw new ConflictException(PASSWORD_REQUIRED);
      }

      await tx.userIdentity.deleteMany({ where: { userId, provider: GOOGLE } });

      return user.email;
    });

    await this.tokens.revokeAllForUser(userId, dto.refreshToken);

    this.notify(googleUnlinkedMail(email, this.accountUrl()), 'el aviso de Google desconectado');
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
    // Solo una cuenta que no existía es noticia para la plataforma; completar
    // una que ya estaba (sin contraseña) no.
    const createsAccount = newAccount !== null && !existing;

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

      // La invitación llegó a este correo: abrirla prueba que es suyo.
      await tx.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });

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

    if (createsAccount) {
      await this.notifyNewAccount(userId, store);
    }

    return this.auth.sessionFor(userId, store.id, context);
  }

  /**
   * Acepta la invitación entrando con Google: sin contraseña.
   *
   * La invitación prueba que el enlace llegó a un correo; Google prueba que la
   * persona que canjea el código controla ese correo. Por eso los dos tienen
   * que coincidir: si no, nada se escribe y el enlace sigue sin usar.
   *
   * Todo lo que escribe va en una transacción: vínculo, membresía e invitación
   * marcada. El aviso y el cierre de sesiones van después, cuando el vínculo ya
   * es real.
   */
  async acceptInvitationWithGoogle(
    dto: GoogleAcceptInvitationDto,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    const found = await this.findPendingInvitation(dto.token);

    if (!found) {
      throw new BadRequestException(INVALID_INVITATION);
    }

    const { invitation, store } = found;
    const invitedEmail = invitation.email.trim().toLowerCase();

    // Canjea el código y exige `email_verified`: si Google no confirma el
    // correo, responde aquí y no llega a comparar nada.
    const profile = await this.google.profileFromCode(dto.code, dto.codeVerifier, dto.redirectUri);

    if (profile.email !== invitedEmail) {
      throw new ForbiddenException({
        message: `Esta invitación es para otro correo. Entra a Google con ${invitedEmail}.`,
        error: 'invitation_email_mismatch',
      });
    }

    const { userId, link, created } = await this.prisma.withTransaction(async (tx) => {
      const account = await this.googleAccountForInvitation(tx, profile, invitedEmail);

      // Abrir la invitación con Google prueba el correo, igual que aceptarla con
      // contraseña.
      await tx.user.update({
        where: { id: account.userId },
        data: { emailVerifiedAt: new Date() },
      });

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

      // Otra pestaña la aceptó un instante antes: se deshace también el vínculo.
      if (claimed.count === 0) {
        throw new BadRequestException(INVALID_INVITATION);
      }

      // Ya miembro (la invitaron dos veces): se respeta el rol que tenía.
      await tx.storeMember.upsert({
        where: { storeId_userId: { storeId: store.id, userId: account.userId } },
        create: { storeId: store.id, userId: account.userId, role: invitation.role },
        update: {},
      });

      return account;
    });

    if (link) {
      await this.auth.afterGoogleLink(link);
    }

    if (created) {
      await this.notifyNewAccount(userId, store);
    }

    return this.auth.sessionFor(userId, store.id, context);
  }

  /**
   * La cuenta que entra con Google a la invitación, dentro de la transacción.
   *
   * 1. Ya hay una identidad de Google: se usa su cuenta, pero solo si su correo
   *    es el invitado. Si no, el `sub` pertenece a otra cuenta y no se toca.
   * 2. Hay una cuenta con ese correo: se vincula con las reglas del §6 y se
   *    devuelve el `link` para avisar después.
   * 3. No hay nada: se crea sin contraseña, con el correo y el nombre de Google.
   */
  private async googleAccountForInvitation(
    tx: TenantClient,
    profile: GoogleProfile,
    invitedEmail: string,
  ): Promise<{ userId: string; link: GoogleLink | null; created: boolean }> {
    const identity = await tx.userIdentity.findUnique({
      where: { provider_providerSubject: { provider: GOOGLE, providerSubject: profile.subject } },
      select: { user: { select: { id: true, email: true } } },
    });

    if (identity) {
      if (identity.user.email !== invitedEmail) {
        throw new ConflictException({
          message: 'Esa cuenta de Google ya está vinculada a otra cuenta de Globerce.',
          error: 'google_account_linked_elsewhere',
        });
      }

      return { userId: identity.user.id, link: null, created: false };
    }

    const existing = await tx.user.findUnique({
      where: { email: invitedEmail },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    if (existing) {
      const link = await this.auth.writeGoogleLink(tx, existing, profile);

      return { userId: existing.id, link, created: false };
    }

    const created = await tx.user.create({
      data: {
        email: invitedEmail,
        fullName: profile.fullName,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        identities: {
          create: {
            provider: GOOGLE,
            providerSubject: profile.subject,
            email: profile.email,
          },
        },
      },
    });

    return { userId: created.id, link: null, created: true };
  }

  /**
   * A la plataforma: nació una cuenta por invitación. Después de la
   * transacción, y `notifyPlatform` nunca lanza.
   */
  private async notifyNewAccount(
    userId: string,
    store: { id: string; name: string },
  ): Promise<void> {
    await this.notifications.notifyPlatform({
      type: 'USER_REGISTERED',
      data: { userId, storeId: store.id, storeName: store.name },
    });
  }

  /** Manda un aviso sin esperarlo: si el SMTP tarda o falla, la respuesta no cambia. */
  private notify(message: MailMessage, what: string): void {
    this.mailer.send(message).catch((error: unknown) => {
      this.logger.error(
        `No se pudo enviar ${what}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** La página que sirve para recuperar la cuenta si no fue quien hizo el cambio. */
  private accountUrl(): string {
    return `${this.config.get('FRONTEND_URL', { infer: true })}/admin/forgot-password`;
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
