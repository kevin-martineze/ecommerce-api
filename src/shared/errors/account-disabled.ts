import { ForbiddenException } from '@nestjs/common';

export const ACCOUNT_DISABLED_MESSAGE =
  'Esta cuenta está deshabilitada. Escríbenos si crees que es un error.';

/**
 * La plataforma deshabilitó la cuenta. 403 y no 401: la sesión es válida, lo
 * que no se permite es usarla. El código `account_disabled` deja que el
 * frontend cierre la sesión en vez de intentar renovarla.
 */
export class AccountDisabledException extends ForbiddenException {
  constructor() {
    super({ message: ACCOUNT_DISABLED_MESSAGE, error: 'account_disabled' });
  }
}
