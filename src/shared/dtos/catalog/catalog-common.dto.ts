import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { QueryBoolean } from '@shared/dtos/transforms';

export class IncludeHiddenQueryDto {
  @ApiPropertyOptional({
    default: false,
    description:
      'Incluye los ocultos. La pantalla de catálogos los necesita; el formulario de una prenda, no.',
  })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeHidden?: boolean;
}

/**
 * Resultado de quitar un color, una talla o una categoría.
 *
 * `hidden` en true: la fila seguía en uso y se ocultó en vez de borrarse. El
 * panel lo necesita para decirle a la dueña qué pasó, porque "lo borré" y "lo
 * escondí" no son lo mismo el día que quiera volver a usarlo.
 */
export class RemovalResultDto {
  @ApiProperty()
  hidden!: boolean;
}
