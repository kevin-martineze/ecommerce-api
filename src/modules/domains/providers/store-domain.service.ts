import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CustomDomainStatus, Prisma } from '@prisma/client';
import { Env } from '@shared/config/env';
import { DnsRecordDto, StoreDomainDto, StoreDomainStateDto } from '@shared/dtos/domains/domain.dto';
import { DnsRecord, DomainProvider, DomainProviderError } from '@shared/domains/domain-provider';
import { domainStatusView } from '@shared/domains/domain-status';
import { checkCustomHost, hostOf, splitHost } from '@shared/domains/host';
import { ownershipValue } from '@shared/domains/ownership';
import { planAllowsCustomDomain } from '@shared/tenancy/custom-domain-plan';
import { PrismaService, TenantClient } from '@db/prisma.service';

const FORBIDDEN_PLAN = 'Tu plan no incluye dominio propio.';
const TAKEN = 'Ese dominio ya lo usa otra tienda.';
const NOTHING_TO_VERIFY = 'Todavía no hay un dominio para verificar.';
const PENDING_DNS = 'Todavía no verificamos el DNS. Pon los registros y pulsa verificar.';
const MISSING_TXT = 'Falta el registro TXT de verificación.';

/** Lo que se lee de la tienda para el dominio. */
const DOMAIN_SELECT = {
  id: true,
  customDomain: true,
  customDomainStatus: true,
  customDomainToken: true,
  customDomainRecords: true,
  customDomainVerifiedAt: true,
  customDomainError: true,
} satisfies Prisma.StoreSelect;

type DomainRow = Prisma.StoreGetPayload<{ select: typeof DOMAIN_SELECT }>;

/** Un dominio con todo lo que hace falta para verificarlo. */
interface ActiveDomain {
  host: string;
  status: CustomDomainStatus;
  token: string;
}

/**
 * El dominio propio de una tienda, desde su panel. Solo la dueña lo maneja: el
 * controlador exige `OWNER`.
 */
@Injectable()
export class StoreDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: DomainProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Lo que el panel muestra: si el plan lo permite y el dominio actual, si hay uno. */
  get(storeId: string): Promise<StoreDomainStateDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      const allowed = await planAllowsCustomDomain(tx, storeId);
      const store = await this.load(tx, storeId);

      return { allowed, domain: toDomainDto(store, allowed) };
    });
  }

  /** Pone el dominio. Queda `pending` hasta que la dueña lo verifique. Reemplazar quita el anterior. */
  async save(storeId: string, rawHost: string): Promise<StoreDomainDto> {
    const check = checkCustomHost(
      rawHost,
      hostOf(this.config.get('FRONTEND_URL', { infer: true })),
    );

    if (!check.ok) throw new BadRequestException(check.message);

    return this.prisma.forStore(storeId, async (tx) => {
      if (!(await planAllowsCustomDomain(tx, storeId))) {
        throw new ForbiddenException(FORBIDDEN_PLAN);
      }

      const store = await this.load(tx, storeId);
      const current = activeDomain(store);

      // Mismo host que ya tiene: nada que cambiar.
      if (current && current.host === check.host) {
        return requireDomainDto(store, true);
      }

      const taken = await tx.store.findUnique({
        where: { customDomain: check.host },
        select: { id: true },
      });

      if (taken && taken.id !== storeId) throw new ConflictException(TAKEN);

      const token = randomBytes(24).toString('hex');

      // Primero el alta del nuevo: si el proveedor no responde, el anterior sigue como estaba.
      const inspection = await providerCall(() => this.provider.inspect(check.host));

      await providerCall(() => this.provider.add(check.host));

      if (current) {
        await providerCall(() => this.provider.remove(current.host));
      }

      const records = [...inspection.records, ownershipRecord(check.apex, check.label, token)];

      try {
        const updated = await tx.store.update({
          where: { id: storeId },
          data: {
            customDomain: check.host,
            customDomainStatus: 'PENDING',
            customDomainToken: token,
            customDomainRecords: records as unknown as Prisma.InputJsonValue,
            customDomainVerifiedAt: null,
            customDomainCheckedAt: null,
            customDomainError: PENDING_DNS,
            customDomainAddedAt: new Date(),
          },
          select: DOMAIN_SELECT,
        });

        return requireDomainDto(updated, true);
      } catch (cause) {
        // Dos tiendas registrando el mismo host a la vez: gana la primera.
        if (isUniqueViolation(cause)) throw new ConflictException(TAKEN);
        throw cause;
      }
    });
  }

  /**
   * Revisa el DNS del dominio. Si está bien, pasa a `active`. Si no, queda
   * `pending`, o pasa a `failed` si ya estaba activo.
   */
  async verify(storeId: string): Promise<StoreDomainDto> {
    return this.prisma.forStore(storeId, async (tx) => {
      if (!(await planAllowsCustomDomain(tx, storeId))) {
        throw new ForbiddenException(FORBIDDEN_PLAN);
      }

      const store = await this.load(tx, storeId);
      const current = activeDomain(store);

      if (!current) throw new NotFoundException(NOTHING_TO_VERIFY);

      // Primero la propiedad (Vercel pide que el TXT ya esté para aceptar su desafío); luego el enrutamiento.
      const owned = await providerCall(() =>
        this.provider.verifyOwnership(current.host, current.token),
      );
      const inspection = await providerCall(() => this.provider.inspect(current.host));
      const ok = inspection.configured && owned;

      const status: CustomDomainStatus = ok
        ? 'ACTIVE'
        : current.status === 'PENDING'
          ? 'PENDING'
          : 'FAILED';

      const parts = splitHost(current.host);
      const records = [
        ...inspection.records,
        ownershipRecord(parts.apex, parts.label, current.token),
      ];

      const updated = await tx.store.update({
        where: { id: storeId },
        data: {
          customDomainStatus: status,
          customDomainRecords: records as unknown as Prisma.InputJsonValue,
          customDomainCheckedAt: new Date(),
          customDomainVerifiedAt: ok ? new Date() : store.customDomainVerifiedAt,
          customDomainError: ok ? null : !inspection.configured ? inspection.error : MISSING_TXT,
        },
        select: DOMAIN_SELECT,
      });

      return requireDomainDto(updated, true);
    });
  }

  /** Quita el dominio del proveedor y de la tienda. Funciona también si el plan ya no lo incluye. */
  async remove(storeId: string): Promise<void> {
    await this.prisma.forStore(storeId, async (tx) => {
      const store = await this.load(tx, storeId);
      const current = activeDomain(store);

      if (current) {
        await providerCall(() => this.provider.remove(current.host));
      }

      await tx.store.update({
        where: { id: storeId },
        data: {
          customDomain: null,
          customDomainStatus: null,
          customDomainToken: null,
          customDomainRecords: Prisma.DbNull,
          customDomainVerifiedAt: null,
          customDomainCheckedAt: null,
          customDomainError: null,
          customDomainAddedAt: null,
        },
      });
    });
  }

  private async load(tx: TenantClient, storeId: string): Promise<DomainRow> {
    const store = await tx.store.findUnique({ where: { id: storeId }, select: DOMAIN_SELECT });

    if (!store) throw new NotFoundException('La tienda no existe.');

    return store;
  }
}

/**
 * Llama al proveedor y traduce sus fallos a respuestas para la dueña. Ningún
 * fallo llega a la base: si el proveedor no responde, el estado no cambia.
 */
export async function providerCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (cause) {
    if (!(cause instanceof DomainProviderError)) throw cause;

    if (cause.kind === 'taken') throw new ConflictException(cause.message);
    if (cause.kind === 'invalid') throw new BadRequestException(cause.message);

    throw new ServiceUnavailableException(cause.message);
  }
}

/** El dominio de la fila, si lo hay. Los tres campos van juntos (CHECK en la base). */
function activeDomain(store: DomainRow): ActiveDomain | null {
  if (!store.customDomain || !store.customDomainStatus || !store.customDomainToken) {
    return null;
  }

  return {
    host: store.customDomain,
    status: store.customDomainStatus,
    token: store.customDomainToken,
  };
}

/** El registro de propiedad: `_globerce` para la raíz, `_globerce.<etiqueta>` para un subdominio. */
function ownershipRecord(apex: boolean, label: string, token: string): DnsRecord {
  return {
    type: 'TXT',
    name: apex ? '_globerce' : `_globerce.${label}`,
    value: ownershipValue(token),
  };
}

function toDomainDto(store: DomainRow, allowed: boolean): StoreDomainDto | null {
  const current = activeDomain(store);

  if (!current) return null;

  return {
    host: current.host,
    status: domainStatusView(current.status, allowed),
    dnsRecords: readRecords(store.customDomainRecords),
    verifiedAt: store.customDomainVerifiedAt,
    lastError: store.customDomainError,
  };
}

/** Para las respuestas que siempre tienen dominio: si no lo tienen, es un error de estado y se responde como 404. */
function requireDomainDto(store: DomainRow, allowed: boolean): StoreDomainDto {
  const dto = toDomainDto(store, allowed);

  if (!dto) throw new NotFoundException(NOTHING_TO_VERIFY);

  return dto;
}

function readRecords(value: Prisma.JsonValue | null): DnsRecordDto[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];

    const { type, name, value: recordValue } = item;

    if (
      (type === 'A' || type === 'CNAME' || type === 'TXT') &&
      typeof name === 'string' &&
      typeof recordValue === 'string'
    ) {
      return [{ type, name, value: recordValue }];
    }

    return [];
  });
}

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002';
}
