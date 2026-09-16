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

interface ColorBody {
  id: string;
  slug: string;
  name: string;
  hex: string;
  usageCount: number;
}

interface SizeBody {
  id: string;
  label: string;
}

interface CategoryBody {
  id: string;
  slug: string;
}

interface ProductBody {
  id: string;
  slug: string;
  categoryId: string | null;
  variants: { id: string; sku: string | null; stock: number }[];
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

  describe('catálogos base', () => {
    it('una tienda nueva arranca con tallas y colores sembrados', async () => {
      const colors = await call<ColorBody[]>('GET', `/stores/${a.storeId}/colors`, a);
      const sizes = await call<SizeBody[]>('GET', `/stores/${a.storeId}/sizes`, a);

      expect(colors.status).toBe(200);
      expect(colors.body.map((color) => color.slug)).toEqual(['negro', 'blanco', 'beige']);
      expect(sizes.body.map((size) => size.label)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    });

    it('crea un color con slug derivado, hex en mayúsculas y numera el repetido', async () => {
      const first = await call<ColorBody>('POST', `/stores/${a.storeId}/colors`, a, {
        name: 'Verde Oliva',
        hex: '#6b7a3a',
      });
      const second = await call<ColorBody>('POST', `/stores/${a.storeId}/colors`, a, {
        name: 'Verde oliva',
        hex: '#6b7a3a',
      });

      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ slug: 'verde-oliva', hex: '#6B7A3A', usageCount: 0 });
      expect(second.body.slug).toBe('verde-oliva-2');
    });

    it('rechaza una talla repetida aunque venga en minúsculas', async () => {
      const { status, body } = await call<ErrorBody>('POST', `/stores/${a.storeId}/sizes`, a, {
        label: ' m ',
      });

      expect(status).toBe(409);
      expect(body.message).toBe('Ya existe esa talla.');
    });

    it('rechaza campos que el DTO no declara', async () => {
      const { status } = await call('POST', `/stores/${a.storeId}/colors`, a, {
        name: 'Rojo',
        hex: '#FF0000',
        storeId: b.storeId,
      });

      expect(status).toBe(400);
    });
  });

  describe('prendas y variantes', () => {
    let categoryA: CategoryBody;
    let categoryB: CategoryBody;
    let product: ProductBody;
    let colorsA: ColorBody[];
    let sizesA: SizeBody[];

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
      colorsA = (await call<ColorBody[]>('GET', `/stores/${a.storeId}/colors`, a)).body;
      sizesA = (await call<SizeBody[]>('GET', `/stores/${a.storeId}/sizes`, a)).body;
    });

    it('no deja colgar una prenda de la categoría de otra tienda', async () => {
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

    it('crea la prenda con slug derivado del nombre', async () => {
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
      expect(body.message).toBe('Ya existe una prenda con ese slug.');
    });

    it('arma la matriz color × talla una sola vez', async () => {
      const matrix = {
        colorIds: colorsA.filter((c) => ['negro', 'blanco'].includes(c.slug)).map((c) => c.id),
        sizeIds: sizesA.filter((s) => ['S', 'M'].includes(s.label)).map((s) => s.id),
        defaultStock: 5,
      };
      const url = `/stores/${a.storeId}/products/${product.id}/variants`;

      const first = await call<{ created: number }>('POST', url, a, matrix);
      const second = await call<{ created: number }>('POST', url, a, matrix);

      expect(first.body.created).toBe(4);
      expect(second.body.created).toBe(0);

      const detail = await call<ProductBody>(
        'GET',
        `/stores/${a.storeId}/products/${product.id}`,
        a,
      );

      expect(detail.body.variants.map((v) => v.sku)).toEqual([
        'VESTIDOLIN-NEGRO-S',
        'VESTIDOLIN-NEGRO-M',
        'VESTIDOLIN-BLANCO-S',
        'VESTIDOLIN-BLANCO-M',
      ]);

      product = detail.body;
    });

    it('no deja armar variantes con un color de otra tienda', async () => {
      const colorsB = (await call<ColorBody[]>('GET', `/stores/${b.storeId}/colors`, b)).body;

      const { status } = await call(
        'POST',
        `/stores/${a.storeId}/products/${product.id}/variants`,
        a,
        {
          colorIds: [colorsB[0]?.id],
          sizeIds: [sizesA[0]?.id],
        },
      );

      expect(status).toBe(400);
    });

    it('numera el SKU cuando otra prenda empieza igual', async () => {
      const twin = await call<ProductBody>('POST', `/stores/${a.storeId}/products`, a, {
        name: 'Vestido Lino Negro',
        basePrice: 150000,
      });

      await call('POST', `/stores/${a.storeId}/products/${twin.body.id}/variants`, a, {
        colorIds: colorsA.filter((c) => c.slug === 'negro').map((c) => c.id),
        sizeIds: sizesA.filter((s) => s.label === 'S').map((s) => s.id),
      });

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

      // No se mira el primer grupo: la prenda gemela del test anterior quedó en
      // stock 0 y va antes. Lo que importa es que de ESTA solo salga la escasa.
      const group = inventory.body.groups.find((g) => g.productId === product.id);

      expect(inventory.status).toBe(200);
      expect(group?.variants.map((v) => v.id)).toEqual([variant.id]);
    });

    it('un color en uso se oculta; una talla sin uso se borra', async () => {
      const negro = colorsA.find((c) => c.slug === 'negro');
      const xs = sizesA.find((s) => s.label === 'XS');

      const color = await call<{ hidden: boolean }>(
        'DELETE',
        `/stores/${a.storeId}/colors/${negro?.id}`,
        a,
      );
      const size = await call<{ hidden: boolean }>(
        'DELETE',
        `/stores/${a.storeId}/sizes/${xs?.id}`,
        a,
      );

      expect(color.body).toEqual({ hidden: true });
      expect(size.body).toEqual({ hidden: false });

      const visible = await call<ColorBody[]>('GET', `/stores/${a.storeId}/colors`, a);
      const all = await call<ColorBody[]>(
        'GET',
        `/stores/${a.storeId}/colors?includeHidden=true`,
        a,
      );

      expect(visible.body.some((c) => c.slug === 'negro')).toBe(false);
      expect(all.body.find((c) => c.slug === 'negro')?.usageCount).toBeGreaterThan(0);
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

      it('B no encuentra la prenda de A ni por su id', async () => {
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

    it('borra una prenda sin pedidos', async () => {
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
