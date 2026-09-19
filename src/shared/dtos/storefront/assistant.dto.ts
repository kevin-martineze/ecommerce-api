import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Trim } from '@shared/dtos/transforms';

/**
 * Lo que se le manda al asistente de una tienda.
 *
 * La conversación viaja entera en cada pregunta y no se guarda en la base: son
 * conversaciones de las clientas de la tienda, y el historial en el navegador
 * es de ellas. Los topes de tamaño no son cosmética — cada palabra que llega
 * acá se paga.
 */
export class AssistantMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ maxLength: 500 })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(500, { message: 'El mensaje es demasiado largo.' })
  content!: string;
}

export class AskAssistantDto {
  @ApiProperty({ type: [AssistantMessageDto], maxItems: 12 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(12, { message: 'La conversación es demasiado larga.' })
  @ValidateNested({ each: true })
  @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[];
}

export class AssistantReplyDto {
  @ApiProperty({ description: 'La respuesta, ya lista para mostrar.' })
  reply!: string;

  @ApiProperty({ description: 'Si conviene seguir la conversación por WhatsApp.' })
  handoff!: boolean;

  @ApiProperty({ description: 'Respuestas que le quedan a la tienda este mes.' })
  remaining!: number;
}
