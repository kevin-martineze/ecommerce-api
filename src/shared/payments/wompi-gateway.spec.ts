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

const gateway = new WompiGateway('https://checkout.wompi.co/p/', keys);

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
