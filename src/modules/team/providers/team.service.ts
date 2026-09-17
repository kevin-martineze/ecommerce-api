import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberRole, Prisma } from '@prisma/client';
import { Env } from '@shared/config/env';
import { CreateInvitationDto, InvitationDto, MemberDto } from '@shared/dtos/team/team.dto';
import { Mailer } from '@shared/mail/mailer';
import { invitationMail } from '@shared/mail/templates';
import { hashSecret, newSecret } from '@shared/utils/secrets';
import { PrismaService } from '@db/prisma.service';
import { TokenService } from '@modules/auth/providers/token.service';

/** Vida de una invitación. Más larga que la de recuperar contraseña: la persona invitada no la esperaba. */
const INVITATION_TTL_DAYS = 7;

const MEMBER_NOT_FOUND = 'Esa persona no es parte del equipo.';
const LAST_OWNER = 'La tienda tiene que tener al menos una dueña.';

const INVITATION_INCLUDE = {
  invitedBy: { select: { email: true } },
} satisfies Prisma.StoreInvitationInclude;

type InvitationWithInviter = Prisma.StoreInvitationGetPayload<{
  include: typeof INVITATION_INCLUDE;
}>;

/**
 * El equipo de una tienda: miembros e invitaciones.
 *
 * `store_members` no está bajo RLS (el guard la consulta para decidir el
 * acceso), así que cada consulta lleva `storeId` explícito. Las invitaciones sí
 * lo están y van por `forStore`.
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mailer: Mailer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async members(storeId: string): Promise<MemberDto[]> {
    const members = await this.prisma.storeMember.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    return members.map((member) => ({
      userId: member.user.id,
      email: member.user.email,
      fullName: member.user.fullName,
      role: member.role,
      joinedAt: member.createdAt,
    }));
  }

  /**
   * Cambia el rol. Nunca deja la tienda sin dueña: el conteo y el cambio van en
   * la misma transacción con las filas de dueñas bloqueadas, para que dos
   * dueñas no se degraden la una a la otra a la vez.
   */
  async changeRole(storeId: string, userId: string, role: MemberRole): Promise<MemberDto[]> {
    await this.prisma.withTransaction(async (tx) => {
      const member = await this.lockMember(tx, storeId, userId);

      if (member.role === 'OWNER' && role !== 'OWNER') {
        await this.assertAnotherOwner(tx, storeId, userId);
      }

      await tx.storeMember.update({
        where: { storeId_userId: { storeId, userId } },
        data: { role },
      });
    });

    return this.members(storeId);
  }

  /** Quita a alguien del equipo y cierra sus sesiones en esta tienda. */
  async remove(storeId: string, userId: string): Promise<void> {
    await this.prisma.withTransaction(async (tx) => {
      const member = await this.lockMember(tx, storeId, userId);

      if (member.role === 'OWNER') {
        await this.assertAnotherOwner(tx, storeId, userId);
      }

      await tx.storeMember.delete({ where: { storeId_userId: { storeId, userId } } });
    });

    // El guard ya lo rechaza en la siguiente petición; esto además evita que
    // su sesión siga refrescándose atada a una tienda que ya no es suya.
    await this.tokens.revokeForStore(userId, storeId);
  }

  invitations(storeId: string): Promise<InvitationDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      const pending = await tx.storeInvitation.findMany({
        where: { storeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        include: INVITATION_INCLUDE,
      });

      return pending.map(toInvitationDto);
    });
  }

  /**
   * Invita a un correo. Una invitación pendiente anterior al mismo correo se
   * anula: solo sirve el último enlace enviado.
   */
  async invite(
    storeId: string,
    invitedById: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationDto> {
    const email = dto.email.trim().toLowerCase();

    const alreadyMember = await this.prisma.storeMember.findFirst({
      where: { storeId, user: { email } },
      select: { userId: true },
    });

    if (alreadyMember) {
      throw new ConflictException('Esa persona ya es parte del equipo.');
    }

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedById },
      select: { fullName: true, email: true },
    });

    if (!store) {
      throw new NotFoundException('Esta tienda no existe.');
    }

    const secret = newSecret();

    const invitation = await this.prisma.forStore(storeId, async (tx) => {
      await tx.storeInvitation.updateMany({
        where: { storeId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return tx.storeInvitation.create({
        data: {
          storeId,
          email,
          role: dto.role,
          tokenHash: hashSecret(secret),
          invitedById,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
        },
        include: INVITATION_INCLUDE,
      });
    });

    const url = `${this.config.get('FRONTEND_URL', { infer: true })}/admin/invitacion?token=${storeId}.${secret}`;

    // Aquí sí se espera: quien invita necesita saber si el correo no salió.
    try {
      await this.mailer.send(
        invitationMail(
          email,
          url,
          store.name,
          inviter?.fullName ?? inviter?.email ?? null,
          INVITATION_TTL_DAYS,
        ),
      );
    } catch (error) {
      this.logger.error(
        `No se pudo enviar la invitación: ${error instanceof Error ? error.message : String(error)}`,
      );

      await this.prisma.forStore(storeId, (tx) =>
        tx.storeInvitation.update({
          where: { id: invitation.id, storeId },
          data: { revokedAt: new Date() },
        }),
      );

      throw new BadRequestException('No pudimos enviar el correo de invitación. Intenta de nuevo.');
    }

    return toInvitationDto(invitation);
  }

  async revokeInvitation(storeId: string, invitationId: string): Promise<void> {
    await this.prisma.forStore(storeId, async (tx) => {
      const { count } = await tx.storeInvitation.updateMany({
        where: { id: invitationId, storeId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (count === 0) {
        throw new NotFoundException('Esa invitación ya no está pendiente.');
      }
    });
  }

  private async lockMember(tx: Prisma.TransactionClient, storeId: string, userId: string) {
    const rows = await tx.$queryRaw<{ role: MemberRole }[]>`
      select role from store_members
      where store_id = ${storeId}::uuid and user_id = ${userId}::uuid
      for update`;

    const member = rows[0];

    if (!member) {
      throw new NotFoundException(MEMBER_NOT_FOUND);
    }

    return member;
  }

  private async assertAnotherOwner(
    tx: Prisma.TransactionClient,
    storeId: string,
    exceptUserId: string,
  ): Promise<void> {
    // Bloquea todas las dueñas: dos degradaciones cruzadas simultáneas se
    // serializan y la segunda ve el resultado de la primera.
    const owners = await tx.$queryRaw<{ user_id: string }[]>`
      select user_id from store_members
      where store_id = ${storeId}::uuid and role = 'OWNER'
      order by user_id
      for update`;

    if (!owners.some((owner) => owner.user_id !== exceptUserId)) {
      throw new ConflictException(LAST_OWNER);
    }
  }
}

function toInvitationDto(invitation: InvitationWithInviter): InvitationDto {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy?.email ?? null,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}
