import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '@shared/config/env';
import { ConnectPaymentsDto, PaymentAccountDto } from '@shared/dtos/payments/payments.dto';
import { GatewayCredentials } from '@shared/payments/gateway';
import { open, seal } from '@shared/payments/secret-box';
import { PrismaService } from '@db/prisma.service';

/**
 * La cuenta con la que cada tienda cobra sus pedidos.
 *
 * La plata de una venta es de la tienda: conecta su propia cuenta de comercio
 * y el cobro sale con sus llaves. Globerce no toca ese dinero, y por eso no
 * necesita ser agregador ni responder por plata ajena.
 *
 * Las llaves secretas se guardan cifradas y no vuelven a salir nunca: el
 * endpoint de lectura devuelve la pública y ya. Un endpoint que devuelve la
 * privada convierte cualquier fuga de sesión en una fuga de la cuenta.
 */
@Injectable()
export class StorePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get secret(): string {
    const secret = this.config.get('PAYMENTS_SECRET', { infer: true });

    if (!secret) {
      throw new BadRequestException(
        'La plataforma no tiene con qué guardar llaves de cobro. Falta PAYMENTS_SECRET.',
      );
    }

    return secret;
  }

  /** La URL que la dueña pega en su panel de Wompi para que nos avise de los pagos. */
  private eventsUrl(storeId: string): string {
    const base = this.config.get('PUBLIC_API_URL', { infer: true });

    return `${base}/payments/events/${storeId}`;
  }

  async get(storeId: string): Promise<PaymentAccountDto> {
    const account = await this.prisma.forStore(storeId, (tx) =>
      tx.storePaymentAccount.findUnique({ where: { storeId } }),
    );

    return {
      connected: Boolean(account?.active),
      provider: account?.provider ?? 'wompi',
      publicKey: account?.publicKey ?? null,
      eventsUrl: this.eventsUrl(storeId),
      updatedAt: account?.updatedAt ?? null,
    };
  }

  async connect(storeId: string, dto: ConnectPaymentsDto): Promise<PaymentAccountDto> {
    const secret = this.secret;

    await this.prisma.forStore(storeId, (tx) =>
      tx.storePaymentAccount.upsert({
        where: { storeId },
        create: {
          storeId,
          publicKey: dto.publicKey,
          privateKeySealed: seal(dto.privateKey, secret),
          integritySecretSealed: seal(dto.integritySecret, secret),
          eventsSecretSealed: seal(dto.eventsSecret, secret),
          active: true,
        },
        update: {
          publicKey: dto.publicKey,
          privateKeySealed: seal(dto.privateKey, secret),
          integritySecretSealed: seal(dto.integritySecret, secret),
          eventsSecretSealed: seal(dto.eventsSecret, secret),
          active: true,
        },
      }),
    );

    return this.get(storeId);
  }

  /**
   * Desconectar no borra las llaves, las desactiva: si la dueña se arrepiente
   * en la misma tarde, no tiene que volver a pedirlas en la pasarela.
   */
  async disconnect(storeId: string): Promise<PaymentAccountDto> {
    await this.prisma.forStore(storeId, async (tx) => {
      const existe = await tx.storePaymentAccount.findUnique({ where: { storeId } });

      if (!existe) throw new NotFoundException('Esta tienda no tiene cuenta de cobro.');

      await tx.storePaymentAccount.update({ where: { storeId }, data: { active: false } });
    });

    return this.get(storeId);
  }

  /** Las llaves de la tienda, descifradas. `null` si no cobra en línea. */
  async credentials(storeId: string): Promise<GatewayCredentials | null> {
    const account = await this.prisma.forStore(storeId, (tx) =>
      tx.storePaymentAccount.findUnique({ where: { storeId } }),
    );

    if (!account || !account.active) return null;

    const secret = this.secret;
    const privateKey = open(account.privateKeySealed, secret);
    const integritySecret = open(account.integritySecretSealed, secret);
    const eventsSecret = open(account.eventsSecretSealed, secret);

    // Si el secreto de la plataforma cambió, las llaves guardadas ya no se
    // pueden leer. Mejor no cobrar que cobrar con basura.
    if (!privateKey || !integritySecret || !eventsSecret) return null;

    return { publicKey: account.publicKey, privateKey, integritySecret, eventsSecret };
  }
}
