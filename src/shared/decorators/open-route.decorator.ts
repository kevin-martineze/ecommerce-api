import { SetMetadata } from '@nestjs/common';

export const IS_OPEN_ROUTE = 'isOpenRoute';

/**
 * Exime a una ruta del secreto compartido del frontend.
 *
 * Solo para lo que tiene que responderle a la infraestructura y no a una
 * persona: las sondas de salud, que las consulta el balanceador o el
 * supervisor del contenedor, sin saber ningún secreto.
 */
export const OpenRoute = () => SetMetadata(IS_OPEN_ROUTE, true);
