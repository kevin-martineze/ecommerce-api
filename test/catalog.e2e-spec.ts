import { Method, Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Catálogo del panel, de punta a punta contra la base.
 *
 * Registra dos tiendas reales y verifica dos cosas: que el panel hace lo que el
 * frontend necesita, y que ninguna tienda puede tocar el catálogo de la otra
 * por ninguno de los caminos —path, token, o un id ajeno dentro del cuerpo—.
 *
 * Corre contra la base de desarrollo y limpia lo que crea al terminar.
 */

jest.setTimeout(30_000);

interface OptionBody {
  id: string;
  name: string;
  sortOrder: number;
  values: { id: string; value: string; hex: string | null; sortOrder: number }[];
}

interface CategoryBody {
  id: string;
  slug: string;
}

interface ProductBody {
  id: string;
  slug: string;
  categoryId: string | null;
  options: OptionBody[];
  attributes: { id: string; name: string; value: string }[];
  variants: { id: string; sku: string | null; stock: number; label: string }[];
}

interface ErrorBody {
  message: string;
}

describe('Catálogo del panel (e2e)', () => {
  let api: TestApp;
  let a: Session;
  let b: Session;

  const call = <T>(method: Method, url: string, session?: Session, payload?: object) =>
    api.call<T>(method, url, session, payload);

  beforeAll(async () => {
    api = await startTestApp();
    a = await api.register('a');
    b = await api.register('b');
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('ejes del producto', () => {
    let producto: ProductBody;

    beforeAll(async () => {
      producto = (
        await call<ProductBody>('POST', `/stores/${a.storeId}/products`, a, {
          name: 'Café Huila',
          basePrice: 38000,
        })
      ).body;
    });

    it('una tienda nueva no trae ejes sembrados: los declara cada producto', async () => {
      const { status, body } = await call<OptionBody[]>(
        'GET',
        `/stores/${a.storeId}/products/${producto.id}/options`,
        a,
      );

      expect(status).toBe(200);
      expect(body).toEqual([]);
    });

    it('declara ejes que no son ropa y conserva su orden', async () => {
      const { status, body } = await call<OptionBody[]>(
        'PUT',
        `/stores/${a.storeId}/products/${producto.id}/options`,
        a,
        {
          options: [
            { name: 'Molienda', values: [{ value: 'Fina' }, { value: 'Gruesa' }] },
            { name: 'Peso', values: [{ value: '250 g' }, { value: '500 g' }] },
          ],
        },
      );

      expect(status).toBe(200);
      expect(body.map((eje) => eje.name)).toEqual(['Molienda', 'Peso']);
      expect(body[0]?.values.map((valor) => valor.value)).toEqual(['Fina', 'Gruesa']);
    });

    it('volver a mandar la lista conserva los ids: editar un eje no borra el inventario', async () => {
      const antes = (
        await call<OptionBody[]>('GET', `/stores/${a.storeId}/products/${producto.id}/options`, a)
      ).body;

      const { body } = await call<OptionBody[]>(
        'PUT',
        `/stores/${a.storeId}/products/${producto.id}/options`,
        a,
        {
          options: [
            { name: 'Molienda', values: [{ value: 'Fina' }, { value: 'Gruesa' }] },
            { name: 'Peso', values: [{ value: '250 g' }, { value: '500 g' }, { value: '1 kg' }] },
          ],
        },
      );

      expect(body[0]?.id).toBe(antes[0]?.id);
      expect(body[1]?.values[0]?.id).toBe(antes[1]?.values[0]?.id);
      expect(body[1]?.values.map((valor) => valor.value)).toEqual(['250 g', '500 g', '1 kg']);
    });

    it('rechaza dos ejes con el mismo nombre', async () => {
      const { status } = await call(
        'PUT',
        `/stores/${a.storeId}/products/${producto.id}/options`,
        a,
        {
          options: [
            { name: 'Peso', values: [{ value: '250 g' }] },
            { name: 'Peso', values: [{ value: '500 g' }] },
          ],
        },
      );

      expect(status).toBe(400);
    });

    it('un producto sin ejes tiene igual su variante única', async () => {
      const libro = (
        await call<ProductBody>('POST', `/stores/${a.storeId}/products`, a, {
          name: 'Cien Años de Soledad',
          basePrice: 65000,
        })
      ).body;

      const { body } = await call<{ created: number }>(
        'POST',
        `/stores/${a.storeId}/products/${libro.id}/variants`,
        a,
        { defaultStock: 3 },
      );

      expect(body.created).toBe(1);

      const detalle = await call<ProductBody>(
        'GET',
        `/stores/${a.storeId}/products/${libro.id}`,
        a,
      );

      expect(detalle.body.variants).toHaveLength(1);
      expect(detalle.body.variants[0]?.label).toBe('');
      expect(detalle.body.variants[0]?.stock).toBe(3);
    });

    it('guarda datos sueltos que ninguna tienda de ropa tendría', async () => {
      const { status, body } = await call<{ name: string; value: string }[]>(
        'PUT',
        `/stores/${a.storeId}/products/${producto.id}/attributes`,
        a,
        {
          attributes: [
            { name: 'Origen', value: 'Huila' },
            { name: 'Tueste', value: 'Medio' },
          ],
        },
      );

      expect(status).toBe(200);
      expect(body.map((dato) => dato.name)).toEqual(['Origen', 'Tueste']);
    });

    it('rechaza campos que el DTO no declara', async () => {
      const { status } = await call(
        'PUT',
        `/stores/${a.storeId}/products/${producto.id}/options`,
        a,
        { options: [], sneaky: true },
      );

      expect(status).toBe(400);
    });
  });

  describe('productos y variantes', () => {
    let categoryA: CategoryBody;
    let categoryB: CategoryBody;
    let product: ProductBody;

    /** Declara los ejes de un producto y devuelve cómo quedaron. */
    const declararEjes = (
      session: Session,
      storeId: string,
      productId: string,
      options: object[],
    ) =>
      call<OptionBody[]>('PUT', `/stores/${storeId}/products/${productId}/options`, session, {
        options,
      });

    beforeAll(async () => {
      categoryA = (
        await call<CategoryBody>('POST', `/stores/${a.storeId}/categories`, a, {
          name: 'Vestidos',
        })
      ).body;
      categoryB = (
        await call<CategoryBody>('POST', `/stores/${b.storeId}/categories`, b, {
          name: 'Vestidos',
        })
      ).body;
    });

    it('no deja colgar un producto de la categoría de otra tienda', async () => {
      const { status } = await call('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Vestido Lino',
        basePrice: 189000,
        categoryId: categoryB.id,
      });

      expect(status).toBe(400);
    });

    it('rechaza un precio tachado que no es mayor que el precio', async () => {
      const { status, body } = await call<ErrorBody>('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Vestido Lino',
        basePrice: 189000,
        compareAtPrice: 189000,
      });

      expect(status).toBe(400);
      expect(body.message).toBe('El precio tachado debe ser mayor que el precio actual.');
    });

    it('crea el producto con slug derivado del nombre', async () => {
      const { status, body } = await call<ProductBody>('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Vestido Lino Arena',
        basePrice: 189000,
        compareAtPrice: 229000,
        categoryId: categoryA.id,
        description: '   ',
      });

      expect(status).toBe(201);
      expect(body).toMatchObject({ slug: 'vestido-lino-arena', categoryId: categoryA.id });

      product = body;
    });

    it('un slug escrito a mano que ya existe es 409', async () => {
      const { status, body } = await call<ErrorBody>('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Otro vestido',
        slug: 'vestido-lino-arena',
        basePrice: 1000,
      });

      expect(status).toBe(409);
      expect(body.message).toBe('Ya existe un producto con ese slug.');
    });

    it('combina los ejes del producto una sola vez', async () => {
      await declararEjes(a, a.storeId, product.id, [
        {
          name: 'Color',
          values: [
            { value: 'Negro', hex: '#000000' },
            { value: 'Blanco', hex: '#ffffff' },
          ],
        },
        { name: 'Talla', values: [{ value: 'S' }, { value: 'M' }] },
      ]);

      const url = `/stores/${a.storeId}/products/${product.id}/variants`;

      const first = await call<{ created: number }>('POST', url, a, { defaultStock: 5 });
      const second = await call<{ created: number }>('POST', url, a, { defaultStock: 5 });

      expect(first.body.created).toBe(4);
      expect(second.body.created).toBe(0);

      const detail = await call<ProductBody>(
        'GET',
        `/stores/${a.storeId}/products/${product.id}`,
        a,
      );

      // En el orden de los ejes, no alfabético: la S va antes que la M.
      expect(detail.body.variants.map((v) => v.sku)).toEqual([
        'VESTIDOLIN-NEGRO-S',
        'VESTIDOLIN-NEGRO-M',
        'VESTIDOLIN-BLANCO-S',
        'VESTIDOLIN-BLANCO-M',
      ]);

      expect(detail.body.variants[0]?.label).toBe('Negro · S');

      product = detail.body;
    });

    it('no deja colgar de una variante el valor de otro producto', async () => {
      const ajeno = (
        await call<ProductBody>('POST', `/stores/${b.storeId}/products`, b, {
          name: 'Camisa Ajena',
          basePrice: 90000,
        })
      ).body;

      const ejesAjenos = (
        await declararEjes(b, b.storeId, ajeno.id, [
          { name: 'Color', values: [{ value: 'Verde', hex: '#00ff00' }] },
        ])
      ).body;

      const { status } = await call(
        'POST',
        `/stores/${a.storeId}/products/${product.id}/variants/one`,
        a,
        { optionValueIds: [ejesAjenos[0]?.values[0]?.id] },
      );

      expect(status).toBe(400);
    });

    it('numera el SKU cuando otra prenda empieza igual', async () => {
      const twin = await call<ProductBody>('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Vestido Lino Negro',
        basePrice: 150000,
      });

      await declararEjes(a, a.storeId, twin.body.id, [
        { name: 'Color', values: [{ value: 'Negro', hex: '#000000' }] },
        { name: 'Talla', values: [{ value: 'S' }] },
      ]);

      await call('POST', `/stores/${a.storeId}/products/${twin.body.id}/variants`, a, {});

      const detail = await call<ProductBody>(
        'GET',
        `/stores/${a.storeId}/products/${twin.body.id}`,
        a,
      );

      expect(detail.body.variants.map((v) => v.sku)).toEqual(['VESTIDOLIN-NEGRO-S-2']);
    });

    it('el stock bajo aparece en inventario', async () => {
      const variant = product.variants[0];

      if (!variant) {
        throw new Error('La prenda no tiene variantes.');
      }

      const patched = await call<{ stock: number }>(
        'PATCH',
        `/stores/${a.storeId}/variants/${variant.id}`,
        a,
        {
          stock: 2,
        },
      );

      expect(patched.body.stock).toBe(2);

      const inventory = await call<{
        lowStockThreshold: number;
        groups: { productId: string; variants: { id: string }[] }[];
      }>('GET', `/stores/${a.storeId}/inventory?lowStock=true`, a);

      // No se mira el primer grupo: el producto gemela del test anterior quedó en
      // stock 0 y va antes. Lo que importa es que de ESTA solo salga la escasa.
      const group = inventory.body.groups.find((g) => g.productId === product.id);

      expect(inventory.status).toBe(200);
      expect(group?.variants.map((v) => v.id)).toEqual([variant.id]);
    });

    it('no deja quitar un valor que alguna variante usa', async () => {
      // Quitar "Negro" dejaría sin uno de sus ejes a dos variantes con stock.
      // Se rechaza en vez de arrastrarlas: borrar inventario en silencio desde
      // una pantalla de atributos sería la peor clase de sorpresa.
      const { status, body } = await declararEjes(a, a.storeId, product.id, [
        { name: 'Color', values: [{ value: 'Blanco', hex: '#ffffff' }] },
        { name: 'Talla', values: [{ value: 'S' }, { value: 'M' }] },
      ]);

      expect(status).toBe(400);
      expect((body as unknown as ErrorBody).message).toContain('variantes');
    });

    it('añadir un valor nuevo sí se puede, y solo crea lo que falta', async () => {
      await declararEjes(a, a.storeId, product.id, [
        {
          name: 'Color',
          values: [
            { value: 'Negro', hex: '#000000' },
            { value: 'Blanco', hex: '#ffffff' },
          ],
        },
        { name: 'Talla', values: [{ value: 'S' }, { value: 'M' }, { value: 'L' }] },
      ]);

      const { body } = await call<{ created: number }>(
        'POST',
        `/stores/${a.storeId}/products/${product.id}/variants`,
        a,
        {},
      );

      // Dos colores × tres tallas son seis; cuatro ya existían.
      expect(body.created).toBe(2);
    });

    describe('aislamiento entre tiendas', () => {
      it('el token de B no puede nombrar a la tienda A', async () => {
        const { status } = await call('GET', `/stores/${a.storeId}/products`, b);

        expect(status).toBe(403);
      });

      it('sin token no hay panel', async () => {
        const { status } = await call('GET', `/stores/${a.storeId}/products`);

        expect(status).toBe(401);
      });

      it('B no encuentra el producto de A ni por su id', async () => {
        const { status } = await call('GET', `/stores/${b.storeId}/products/${product.id}`, b);

        expect(status).toBe(404);
      });

      it('B no puede cambiar el stock de una variante de A', async () => {
        const variantId = product.variants[0]?.id;

        const { status } = await call('PATCH', `/stores/${b.storeId}/variants/${variantId}`, b, {
          stock: 999,
        });

        expect(status).toBe(404);
      });
    });

    it('borra un producto sin pedidos', async () => {
      const { status, body } = await call<{ result: string }>(
        'DELETE',
        `/stores/${a.storeId}/products/${product.id}`,
        a,
      );

      expect(status).toBe(200);
      expect(body).toEqual({ result: 'deleted' });

      const gone = await call('GET', `/stores/${a.storeId}/products/${product.id}`, a);

      expect(gone.status).toBe(404);
    });
  });
});
