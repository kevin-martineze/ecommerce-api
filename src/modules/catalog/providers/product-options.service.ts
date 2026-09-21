import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ProductAttributeDto,
  ProductOptionDto,
  SetProductAttributesDto,
  SetProductOptionsDto,
} from '@shared/dtos/catalog/product-option.dto';
import { PrismaService } from '@db/prisma.service';

const PRODUCTO_NO_EXISTE = 'Ese producto no existe.';

/**
 * Los ejes de un producto y sus datos sueltos.
 *
 * Reemplaza a las listas de colores y variaciones de la tienda. Aquellas obligaban
 * a que toda tienda vendiera por color y variación; estas las declara cada
 * producto, así que la misma tienda puede vender camisas por variación, libros por
 * formato y café por molienda y peso.
 *
 * Las dos operaciones son declarativas: se manda la lista completa y queda esa.
 * La pantalla que las usa edita la lista completa, y un API incremental la
 * obligaría a calcular altas y bajas para reconstruir lo que ya tiene.
 */
@Injectable()
export class ProductOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(storeId: string, productId: string): Promise<ProductOptionDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      await this.assertProduct(tx, storeId, productId);

      const options = await tx.productOption.findMany({
        where: { storeId, productId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          values: { orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }] },
        },
      });

      return options.map(toOptionDto);
    });
  }

  /**
   * Deja los ejes del producto exactamente como vengan.
   *
   * Lo que se conserva se conserva POR NOMBRE: si "Variación" sigue en la lista,
   * sus valores mantienen su id, y con ellos las variantes que los usan. Solo
   * así se puede añadir un color sin destruir el inventario.
   *
   * Quitar un valor que alguna variante usa se rechaza en vez de arrastrar la
   * variante: borrar stock en silencio, desde una pantalla de edición de
   * atributos, sería la peor clase de sorpresa.
   */
  setOptions(
    storeId: string,
    productId: string,
    dto: SetProductOptionsDto,
  ): Promise<ProductOptionDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      await this.assertProduct(tx, storeId, productId);

      const nombres = dto.options.map((opcion) => opcion.name.trim());

      if (new Set(nombres).size !== nombres.length) {
        throw new BadRequestException('Hay dos ejes con el mismo nombre.');
      }

      const actuales = await tx.productOption.findMany({
        where: { storeId, productId },
        include: { values: { select: { id: true, value: true } } },
      });

      const sobran = actuales.filter((actual) => !nombres.includes(actual.name));

      await this.assertSinVariantes(
        tx,
        storeId,
        sobran.flatMap((opcion) => opcion.values.map((valor) => valor.id)),
        'Ese eje lo usan variantes que ya existen. Bórralas primero.',
      );

      if (sobran.length > 0) {
        await tx.productOption.deleteMany({
          where: { storeId, id: { in: sobran.map((opcion) => opcion.id) } },
        });
      }

      for (const [indice, entrada] of dto.options.entries()) {
        const nombre = entrada.name.trim();
        const anterior = actuales.find((actual) => actual.name === nombre);

        const opcion = anterior
          ? await tx.productOption.update({
              where: { id: anterior.id, storeId },
              data: { sortOrder: indice },
            })
          : await tx.productOption.create({
              data: { storeId, productId, name: nombre, sortOrder: indice },
            });

        await this.setValues(tx, storeId, opcion.id, anterior?.values ?? [], entrada.values);
      }

      return this.listar(tx, storeId, productId);
    });
  }

  attributes(storeId: string, productId: string): Promise<ProductAttributeDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      await this.assertProduct(tx, storeId, productId);

      const rows = await tx.productAttribute.findMany({
        where: { storeId, productId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return rows.map(toAttributeDto);
    });
  }

  /** Los datos sueltos no los usa nadie más, así que se rehacen enteros. */
  setAttributes(
    storeId: string,
    productId: string,
    dto: SetProductAttributesDto,
  ): Promise<ProductAttributeDto[]> {
    return this.prisma.forStore(storeId, async (tx) => {
      await this.assertProduct(tx, storeId, productId);

      const nombres = dto.attributes.map((atributo) => atributo.name.trim());

      if (new Set(nombres).size !== nombres.length) {
        throw new BadRequestException('Hay dos datos con el mismo nombre.');
      }

      await tx.productAttribute.deleteMany({ where: { storeId, productId } });

      if (dto.attributes.length > 0) {
        await tx.productAttribute.createMany({
          data: dto.attributes.map((atributo, indice) => ({
            storeId,
            productId,
            name: atributo.name.trim(),
            value: atributo.value.trim(),
            sortOrder: indice,
          })),
        });
      }

      const rows = await tx.productAttribute.findMany({
        where: { storeId, productId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });

      return rows.map(toAttributeDto);
    });
  }

  private async setValues(
    tx: TransactionClient,
    storeId: string,
    optionId: string,
    anteriores: readonly { id: string; value: string }[],
    entrantes: readonly { value: string; hex?: string }[],
  ): Promise<void> {
    const valores = entrantes.map((entrada) => entrada.value.trim());

    if (new Set(valores).size !== valores.length) {
      throw new BadRequestException('Hay dos valores iguales en el mismo eje.');
    }

    const sobran = anteriores.filter((anterior) => !valores.includes(anterior.value));

    await this.assertSinVariantes(
      tx,
      storeId,
      sobran.map((valor) => valor.id),
      'Ese valor lo usan variantes que ya existen. Bórralas primero.',
    );

    if (sobran.length > 0) {
      await tx.productOptionValue.deleteMany({
        where: { storeId, id: { in: sobran.map((valor) => valor.id) } },
      });
    }

    for (const [indice, entrada] of entrantes.entries()) {
      const valor = entrada.value.trim();
      const anterior = anteriores.find((candidato) => candidato.value === valor);

      if (anterior) {
        await tx.productOptionValue.update({
          where: { id: anterior.id, storeId },
          data: { hex: entrada.hex ?? null, sortOrder: indice },
        });
      } else {
        await tx.productOptionValue.create({
          data: { storeId, optionId, value: valor, hex: entrada.hex ?? null, sortOrder: indice },
        });
      }
    }
  }

  /** Ningún valor que esté dentro de una variante puede desaparecer. */
  private async assertSinVariantes(
    tx: TransactionClient,
    storeId: string,
    valueIds: readonly string[],
    mensaje: string,
  ): Promise<void> {
    if (valueIds.length === 0) return;

    const enUso = await tx.variantOptionValue.findFirst({
      where: { storeId, optionValueId: { in: [...valueIds] } },
      select: { variantId: true },
    });

    if (enUso) {
      throw new BadRequestException(mensaje);
    }
  }

  private async assertProduct(
    tx: TransactionClient,
    storeId: string,
    productId: string,
  ): Promise<void> {
    const product = await tx.product.findFirst({
      where: { id: productId, storeId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException(PRODUCTO_NO_EXISTE);
    }
  }

  private async listar(
    tx: TransactionClient,
    storeId: string,
    productId: string,
  ): Promise<ProductOptionDto[]> {
    const options = await tx.productOption.findMany({
      where: { storeId, productId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { values: { orderBy: [{ sortOrder: 'asc' }, { value: 'asc' }] } },
    });

    return options.map(toOptionDto);
  }
}

type TransactionClient = Parameters<Parameters<PrismaService['forStore']>[1]>[0];

function toOptionDto(option: {
  id: string;
  name: string;
  sortOrder: number;
  values: { id: string; value: string; hex: string | null; sortOrder: number }[];
}): ProductOptionDto {
  return {
    id: option.id,
    name: option.name,
    sortOrder: option.sortOrder,
    values: option.values.map((valor) => ({
      id: valor.id,
      value: valor.value,
      hex: valor.hex,
      sortOrder: valor.sortOrder,
    })),
  };
}

function toAttributeDto(attribute: {
  id: string;
  name: string;
  value: string;
  sortOrder: number;
}): ProductAttributeDto {
  return {
    id: attribute.id,
    name: attribute.name,
    value: attribute.value,
    sortOrder: attribute.sortOrder,
  };
}
