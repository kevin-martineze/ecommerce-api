import { SetMetadata } from '@nestjs/common';

export const ALLOWED_WITHOUT_SUBSCRIPTION = 'allowedWithoutSubscription';

/**
 * Deja pasar la ruta aunque el plan de la tienda esté vencido.
 *
 * Sin esto, la pantalla donde se paga quedaría del otro lado del bloqueo que
 * existe justamente para obligar a pagar.
 */
export const AllowedWithoutSubscription = () => SetMetadata(ALLOWED_WITHOUT_SUBSCRIPTION, true);
