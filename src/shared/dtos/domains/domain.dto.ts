import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import type { DomainStatusView } from '@shared/domains/domain-status';

const DOMAIN_STATUS_VALUES = ['pending', 'active', 'failed', 'disabled'] as const;

export class UpsertStoreDomainDto {
  @ApiProperty({ example: 'www.mitienda.com', description: 'El dominio, sin protocolo ni ruta.' })
  @IsString({ message: 'El dominio tiene que ser texto.' })
  @MaxLength(300, { message: 'Ese dominio es demasiado largo.' })
  host!: string;
}

export class DnsRecordDto {
  @ApiProperty({ enum: ['A', 'CNAME', 'TXT'] })
  type!: 'A' | 'CNAME' | 'TXT';

  @ApiProperty({ description: 'Relativo a la zona: `www`, `@`, `_globerce.www`.' })
  name!: string;

  @ApiProperty()
  value!: string;
}

export class StoreDomainDto {
  @ApiProperty()
  host!: string;

  @ApiProperty({ enum: DOMAIN_STATUS_VALUES })
  status!: DomainStatusView;

  @ApiProperty({ type: [DnsRecordDto] })
  dnsRecords!: DnsRecordDto[];

  @ApiProperty({ nullable: true })
  verifiedAt!: Date | null;

  @ApiProperty({ nullable: true })
  lastError!: string | null;
}

export class StoreDomainStateDto {
  @ApiProperty({ description: 'Si el plan vigente incluye dominio propio.' })
  allowed!: boolean;

  @ApiProperty({ type: StoreDomainDto, nullable: true })
  domain!: StoreDomainDto | null;
}

export class PublicStoreDomainDto {
  @ApiProperty()
  slug!: string;

  @ApiProperty({ enum: DOMAIN_STATUS_VALUES })
  status!: DomainStatusView;
}
