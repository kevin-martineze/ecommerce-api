/**
 * Dónde se registran los dominios propios.
 *
 * Clase abstracta para usarla como token de inyección, igual que `Mailer`: el
 * servicio pide `DomainProvider` y el entorno decide si detrás hay un log o
 * Vercel.
 */

export type DnsRecordType = 'A' | 'CNAME' | 'TXT';

/** Un registro que la dueña pone en su DNS. `name` es relativo a la zona: `www`, `@`, `_globerce.www`. */
export interface DnsRecord {
  type: DnsRecordType;
  name: string;
  value: string;
}

export interface DomainInspection {
  /** Si el registro de enrutamiento ya apunta a la plataforma. */
  configured: boolean;
  /** Los registros de enrutamiento que pide el proveedor. */
  records: DnsRecord[];
  /** Qué falta, dicho para la dueña. Null cuando `configured` es true. */
  error: string | null;
}

export abstract class DomainProvider {
  /** Registra el host en la plataforma. Idempotente: registrar dos veces no falla. */
  abstract add(host: string): Promise<void>;

  /** Lo que el proveedor ve del enrutamiento del host. */
  abstract inspect(host: string): Promise<DomainInspection>;

  /** Si el TXT de propiedad está puesto con este token. */
  abstract verifyOwnership(host: string, token: string): Promise<boolean>;

  /** Quita el host de la plataforma. Quitar uno que no existe no falla. */
  abstract remove(host: string): Promise<void>;
}
