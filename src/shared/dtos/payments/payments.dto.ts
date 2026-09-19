import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

/**
 * Conectar la cuenta de cobro de una tienda.
 *
 * Las llaves son de la tienda y nunca vuelven: se guardan cifradas y lo único
 * que se devuelve después es la pública, que para eso es pública. Un endpoint
 * que devuelve la llave privada convierte cualquier fuga de sesión en una fuga
 * de la cuenta de comercio.
 */
export class ConnectPaymentsDto {
  @ApiProperty({ example: 'pub_prod_XXXXXXXX', description: 'Llave pública de Wompi.' })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @Matches(/^pub_/, { message: 'La llave pública empieza por `pub_`.' })
  publicKey!: string;

  @ApiProperty({ example: 'prv_prod_XXXXXXXX', description: 'Llave privada de Wompi.' })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @Matches(/^prv_/, { message: 'La llave privada empieza por `prv_`.' })
  privateKey!: string;

  @ApiProperty({ description: 'Secreto de integridad: firma el enlace de pago.' })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  integritySecret!: string;

  @ApiProperty({ description: 'Secreto de eventos: con él se comprueba lo que manda la pasarela.' })
  @Trim()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  eventsSecret!: string;
}

export class PaymentAccountDto {
  @ApiProperty({ description: 'Si la tienda puede cobrar en línea hoy.' })
  connected!: boolean;

  @ApiProperty()
  provider!: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'La pública, entera. Las secretas no vuelven.',
  })
  publicKey!: string | null;

  @ApiProperty({ description: 'La URL que la tienda pega en su panel de la pasarela.' })
  eventsUrl!: string;

  @ApiPropertyOptional({ nullable: true })
  updatedAt!: Date | null;
}

export class OrderCheckoutDto {
  @ApiProperty({ description: 'Token público del pedido: es la credencial del enlace.' })
  @Trim()
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  token!: string;

  @ApiProperty({ description: 'A dónde vuelve la clienta. Tiene que ser una dirección nuestra.' })
  @Trim()
  @IsUrl({ require_tld: false }, { message: 'La dirección de vuelta no es válida.' })
  @MaxLength(300)
  redirectUrl!: string;
}

export class PaymentLinkDto {
  @ApiProperty()
  url!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty()
  amountCop!: number;
}
