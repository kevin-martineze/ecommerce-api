import { createHash } from 'node:crypto';

import { GatewayCredentials } from './gateway';
import { WompiGateway } from './wompi-gateway';

/**
 * La firma es lo único que distingue a Wompi de cualquiera que sepa nuestra
 * URL. No hay forma de probarla contra la pasarela sin una cuenta de comercio,
 * así que se prueba contra el mismo cálculo que ella hace, documentado.
 */

const keys: GatewayCredentials = {
  publicKey: 'pub_test_llave',
  privateKey: 'prv_test_llave',
  integritySecret: 'secreto-de-integridad',
  eventsSecret: 'secreto-de-eventos',
};

const gateway = new WompiGateway(
  'https://checkout.wompi.co/p/',
  'https://sandbox.wompi.co/v1',
  keys,
);

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Un evento como los que manda Wompi, con su firma bien hecha. */
function evento(overrides: { status?: string; cents?: number; checksum?: string } = {}) {
  const transaction = {
    id: 'trx-123',
    reference: 'sub-abc',
    status: overrides.status ?? 'APPROVED',
    amount_in_cents: overrides.cents ?? 99_000_00,
    payment_method_type: 'CARD',
  };

  const timestamp = 1_700_000_000;
  const properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
  const concatenado = `${transaction.id}${transaction.status}${transaction.amount_in_cents}`;

  return {
    event: 'transaction.updated',
    data: { transaction },
    timestamp,
    signature: {
      properties,
      checksum: overrides.checksum ?? sha256(`${concatenado}${timestamp}${keys.eventsSecret}`),
    },
  };
}

/** Finge la API de Wompi y deja ver con qué se la llamó. */
function fingirApi(respuesta: unknown, status = 200) {
  const llamadas: { url: string; init?: RequestInit }[] = [];

  globalThis.fetch = ((url: string, init?: RequestInit) => {
    llamadas.push({ url, init });

    return Promise.resolve({
      ok: status < 400,
      status,
      text: () => Promise.resolve(JSON.stringify(respuesta)),
    } as Response);
  }) as typeof fetch;

  return {
    llamadas,
    cuerpo: (indice = 0): Record<string, unknown> =>
      JSON.parse(String(llamadas[indice]?.init?.body ?? '{}')) as Record<string, unknown>,
  };
}

describe('WompiGateway', () => {
  describe('el enlace de pago', () => {
    it('va firmado, para que el monto no se pueda cambiar en la URL', () => {
      const { url } = gateway.checkout({
        reference: 'sub-abc',
        amountCop: 99_000,
        description: 'Plan Pro',
        redirectUrl: 'https://globerce.store/admin/plan',
      });

      const params = new URL(url).searchParams;

      // El peso no tiene centavos, pero la API los pide: confundir la unidad
      // es cobrar cien veces de más.
      expect(params.get('amount-in-cents')).toBe('9900000');
      expect(params.get('currency')).toBe('COP');
      expect(params.get('signature:integrity')).toBe(
        sha256(`sub-abc9900000COP${keys.integritySecret}`),
      );
    });
  });

  describe('la tarjeta guardada', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('se guarda con el token del navegador, nunca con la tarjeta', async () => {
      const api = fingirApi({
        data: { id: 1234, public_data: { brand: 'VISA', last_four: '4242' } },
      });

      const source = await gateway.createPaymentSource({
        cardToken: 'tok_test_123',
        acceptanceToken: 'acc_test_123',
        customerEmail: 'maria@correo.com',
      });

      expect(source).toEqual({ id: '1234', brand: 'VISA', last4: '4242' });
      expect(api.cuerpo()).toEqual({
        type: 'CARD',
        token: 'tok_test_123',
        customer_email: 'maria@correo.com',
        acceptance_token: 'acc_test_123',
      });
      // La llave privada nunca sale del servidor, pero sí tiene que ir acá.
      expect(api.llamadas[0]?.init?.headers).toMatchObject({
        authorization: `Bearer ${keys.privateKey}`,
      });
    });

    it('el cobro va firmado, igual que el enlace de pago', async () => {
      fingirApi({ data: { id: 'trx-9', status: 'APPROVED', amount_in_cents: 9_900_000 } });

      const event = await gateway.charge({
        reference: 'sub-abc',
        amountCop: 99_000,
        description: 'Plan Pro',
        customerEmail: 'maria@correo.com',
        paymentSourceId: '1234',
      });

      expect(event.status).toBe('approved');
      expect(event.amountCop).toBe(99_000);
    });

    it('el cobro se anuncia como iniciado por el comercio', async () => {
      const api = fingirApi({ data: { id: 'trx-9', status: 'APPROVED' } });

      await gateway.charge({
        reference: 'sub-abc',
        amountCop: 99_000,
        description: 'Plan Pro',
        customerEmail: 'maria@correo.com',
        paymentSourceId: '1234',
      });

      // Sin `recurrent` el banco rechaza un cobro que llega sin nadie delante.
      expect(api.cuerpo()).toMatchObject({
        recurrent: true,
        payment_source_id: 1234,
        amount_in_cents: 9_900_000,
        signature: sha256(`sub-abc9900000COP${keys.integritySecret}`),
      });
    });

    it('un rechazo de la API no se confunde con un cobro hecho', async () => {
      fingirApi({ error: { reason: 'tarjeta vencida' } }, 422);

      await expect(
        gateway.charge({
          reference: 'sub-abc',
          amountCop: 99_000,
          description: 'Plan Pro',
          customerEmail: 'maria@correo.com',
          paymentSourceId: '1234',
        }),
      ).rejects.toThrow('422');
    });
  });

  describe('el evento', () => {
    it('bien firmado se traduce, y el monto vuelve a pesos', () => {
      expect(gateway.parseEvent(evento())).toEqual({
        reference: 'sub-abc',
        transactionId: 'trx-123',
        status: 'approved',
        amountCop: 99_000,
        method: 'card',
      });
    });

    it('con la firma cambiada no existe', () => {
      expect(gateway.parseEvent(evento({ checksum: 'a'.repeat(64) }))).toBeNull();
    });

    it('un pago rechazado se reconoce como tal', () => {
      expect(gateway.parseEvent(evento({ status: 'DECLINED' }))?.status).toBe('declined');
      expect(gateway.parseEvent(evento({ status: 'PENDING' }))?.status).toBe('pending');
    });

    it('lo que no es un evento de transacción se ignora', () => {
      expect(gateway.parseEvent({ ...evento(), event: 'nequi_token.updated' })).toBeNull();
      expect(gateway.parseEvent(null)).toBeNull();
      expect(gateway.parseEvent({ data: {} })).toBeNull();
    });
  });
});
