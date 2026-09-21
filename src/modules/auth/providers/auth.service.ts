import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from '@shared/dtos/auth/login.dto';
import { CreateStoreDto, RegisterStoreDto } from '@shared/dtos/auth/register-store.dto';
import {
  MeResponseDto,
  SessionResponseDto,
  SessionStoreDto,
} from '@shared/dtos/auth/session-response.dto';
import { PrismaService, TenantClient } from '@db/prisma.service';

import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * Intentos fallidos seguidos antes de bloquear la cuenta, y por cuánto.
 *
 * El límite por IP del throttler no cubre a un atacante que rota direcciones
 * contra un mismo correo; esto sí. Quince minutos es suficiente para volver
 * inviable la fuerza bruta sin convertir el bloqueo en un ataque de denegación
 * contra la dueña de la tienda: el atacante que quiera dejarla afuera tiene que
 * fallar cada quince minutos, para siempre.
 */
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;

/** Días de prueba antes del primer cobro. */
const TRIAL_DAYS = 14;

/** Con qué plan arranca quien no eligió ninguno. */
const DEFAULT_PLAN = 'basico';

export interface RequestContext {
  userAgent?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** Da de alta una tienda y la cuenta de su dueña, en una sola transacción. */
  async registerStore(
    dto: RegisterStoreDto,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    const email = dto.email.trim().toLowerCase();

    await this.assertEmailAvailable(email);
    await this.assertSlugAvailable(dto.storeSlug);

    const passwordHash = await this.passwords.hash(dto.password);

    const { user, store } = await this.prisma.withTransaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email, fullName: dto.fullName.trim(), passwordHash },
      });

      const createdStore = await this.provisionStore(tx, createdUser.id, dto);

      return { user: createdUser, store: createdStore };
    });

    this.logger.log(`Tienda registrada: ${store.slug}`);

    const issued = await this.tokens.issue(user.id, user.email, store.id, context);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores: [{ id: store.id, name: store.name, slug: store.slug, role: 'OWNER' }],
      activeStoreId: store.id,
    };
  }

  /**
   * Una tienda más para una cuenta que ya existe. La sesión presentada rota a
   * una nueva atada a la tienda recién creada, igual que al cambiar de tienda.
   */
  async createStore(
    userId: string,
    dto: CreateStoreDto,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    await this.assertSlugAvailable(dto.storeSlug);

    const store = await this.prisma.withTransaction((tx) => this.provisionStore(tx, userId, dto));

    this.logger.log(`Tienda registrada: ${store.slug}`);

    const issued = await this.tokens.rotate(dto.refreshToken, store.id, context, userId);
    const user = await this.requireUserWithStores(userId);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores: toSessionStores(user.memberships),
      activeStoreId: store.id,
    };
  }

  async login(dto: LoginDto, context: RequestContext = {}): Promise<SessionResponseDto> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { store: true }, orderBy: { createdAt: 'asc' } } },
    });

    if (!user || !user.passwordHash) {
      // Se gasta el mismo tiempo que costaría verificar de verdad. Sin esto, un
      // correo inexistente responde en microsegundos y uno real en decenas de
      // milisegundos, y esa diferencia deja enumerar cuentas con un cronómetro.
      await this.passwords.burnTime();

      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(
        'La cuenta está bloqueada temporalmente por intentos fallidos. Intenta de nuevo en unos minutos.',
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, dto.password);

    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);

      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    // Las cuentas migradas desde Supabase llegan con bcrypt. Este es el único
    // momento en que se tiene la contraseña en claro, así que se aprovecha para
    // dejarla en argon2id. Ver PasswordService.
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(dto.password) },
      });
    }

    const stores = toSessionStores(user.memberships);
    const activeStoreId = stores[0]?.id ?? null;

    const issued = await this.tokens.issue(user.id, user.email, activeStoreId, context);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores,
      activeStoreId,
    };
  }

  /**
   * Cambia la tienda activa emitiendo una sesión nueva.
   *
   * No se "reinterpreta" el token existente: se verifica la membresía y se
   * emite otro. Que el token quede atado a una sola tienda es lo que hace que
   * la capa 2 del aislamiento signifique algo.
   */
  async switchStore(
    userId: string,
    storeId: string,
    presentedRefreshToken: string,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    const membership = await this.prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId, userId } },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes acceso a esa tienda.');
    }

    const issued = await this.tokens.rotate(presentedRefreshToken, storeId, context, userId);
    const user = await this.requireUserWithStores(userId);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores: toSessionStores(user.memberships),
      activeStoreId: storeId,
    };
  }

  async refresh(refreshToken: string, context: RequestContext = {}): Promise<SessionResponseDto> {
    const issued = await this.tokens.rotate(refreshToken, undefined, context);

    const payload = decodeSubject(issued.accessToken);
    const user = await this.requireUserWithStores(payload.sub);
    const stores = toSessionStores(user.memberships);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores,
      activeStoreId: payload.storeId,
    };
  }

  async me(userId: string): Promise<MeResponseDto> {
    const user = await this.requireUserWithStores(userId);

    return {
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores: toSessionStores(user.memberships),
      isPlatformAdmin: user.platformAdmin !== null,
    };
  }

  /**
   * Emite una sesión para una cuenta ya verificada por otro camino (aceptar
   * una invitación). Nunca debe llamarse sin haber probado antes la identidad.
   */
  async sessionFor(
    userId: string,
    storeId: string | null,
    context: RequestContext = {},
  ): Promise<SessionResponseDto> {
    const user = await this.requireUserWithStores(userId);
    const issued = await this.tokens.issue(user.id, user.email, storeId, context);

    return {
      ...issued,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      stores: toSessionStores(user.memberships),
      activeStoreId: storeId,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  /**
   * Crea la tienda con su dueña y lo mínimo para operar, dentro de la
   * transacción que recibe.
   *
   * El orden importa y no es arbitrario: `stores` y `store_members` no están
   * bajo RLS —hay que poder resolverlos antes de saber de qué tienda hablamos—
   * pero todo lo que cuelga de la tienda sí lo está. Por eso se fija el
   * contexto justo después de crear la tienda y justo antes de lo primero que
   * RLS protege.
   */
  private async provisionStore(
    tx: TenantClient,
    userId: string,
    dto: Pick<RegisterStoreDto, 'storeName' | 'storeSlug' | 'whatsappPhone' | 'planCode'>,
  ) {
    // El plan que eligió en la web. Uno retirado o inventado cae en el básico:
    // no es motivo para que el registro falle después de crear la cuenta.
    const chosen = dto.planCode
      ? await tx.plan.findFirst({
          where: { code: dto.planCode, active: true },
          select: { code: true },
        })
      : null;

    const store = await tx.store.create({
      data: {
        name: dto.storeName.trim(),
        slug: dto.storeSlug,
        status: 'TRIAL',
        trialEndsAt: daysFromNow(TRIAL_DAYS),
      },
    });

    await tx.storeMember.create({ data: { storeId: store.id, userId, role: 'OWNER' } });

    // A partir de acá todo está bajo RLS: sin esta línea, cada insert de abajo
    // fallaría contra su propia política.
    await this.prisma.setStoreContext(tx, store.id);

    await tx.storeSettings.create({
      data: { storeId: store.id, whatsappPhone: dto.whatsappPhone },
    });

    await tx.subscription.create({
      data: {
        storeId: store.id,
        planCode: chosen?.code ?? DEFAULT_PLAN,
        status: 'TRIALING',
        currentPeriodEnd: daysFromNow(TRIAL_DAYS),
      },
    });

    // Ya no se siembran variaciones ni colores: los ejes de cada producto los
    // declara ese producto, y sembrar "S, M, L" en la tienda de una librería
    // sería estorbo. Lo que el rubro sugiera se resuelve en el onboarding, no
    // creando filas que quizá nadie use.

    return store;
  }

  private async requireUserWithStores(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { store: true }, orderBy: { createdAt: 'asc' } },
        platformAdmin: { select: { userId: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
    }

    return user;
  }

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const attempts = current + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (existing) {
      // El código le dice al frontend bajo qué campo poner el mensaje; sin él
      // tendría que adivinarlo leyendo el texto en español.
      throw new ConflictException({
        message: 'Ya existe una cuenta con ese correo.',
        error: 'email_taken',
      });
    }
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const existing = await this.prisma.store.findUnique({ where: { slug }, select: { id: true } });

    if (existing) {
      throw new ConflictException({
        message: 'Esa dirección ya está tomada. Prueba con otra.',
        error: 'slug_taken',
      });
    }
  }
}

interface MembershipWithStore {
  role: string;
  store: { id: string; name: string; slug: string };
}

function toSessionStores(memberships: MembershipWithStore[]): SessionStoreDto[] {
  return memberships.map((membership) => ({
    id: membership.store.id,
    name: membership.store.name,
    slug: membership.store.slug,
    role: membership.role,
  }));
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

/**
 * Lee `sub` y `storeId` del access token recién emitido.
 *
 * Es el token que acaba de firmar este mismo proceso hace un instante, así que
 * no hace falta verificar la firma: decodificar alcanza. Nunca debe usarse este
 * atajo con un token que venga de afuera.
 */
function decodeSubject(accessToken: string): { sub: string; storeId: string | null } {
  const segment = accessToken.split('.')[1];

  if (!segment) {
    throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
  }

  const decoded: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

  if (typeof decoded !== 'object' || decoded === null || !('sub' in decoded)) {
    throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
  }

  const payload = decoded as { sub: unknown; storeId?: unknown };

  if (typeof payload.sub !== 'string') {
    throw new UnauthorizedException('La sesión no es válida. Vuelve a entrar.');
  }

  return {
    sub: payload.sub,
    storeId: typeof payload.storeId === 'string' ? payload.storeId : null,
  };
}
