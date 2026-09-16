import { Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Tienda pública de punta a punta.
 *
 * Arma un catálogo real por las rutas del panel —con una prenda en borrador,
 * una categoría oculta, una variante sin stock— y verifica que la visitante ve
 * exactamente lo que veía con las políticas de Supabase: lo publicado, nada más.
 */

jest.setTimeout(30_000);

interface Card {
  slug: string;
  inStock: boolean;
  colors: { slug: string }[];
}

interface Page {
  products: Card[];
  total: number;
  pageCount: number;
}

interface PanelProduct {
  id: string;
  slug: string;
  variants: { id: string; color: { slug: string }; size: { label: string } }[];
}

describe('Tienda pública (e2e)', () => {
  let api: TestApp;
  let shop: Session;
  let other: Session;

  const products: Record<string, PanelProduct> = {};

  const pub = <T>(url: string) => api.call<T>('GET', `/public/${shop.slug}${url}`);

  const slugs = (cards: Card[]) => cards.map((card) => card.slug);

  beforeAll(async () => {
    api = await startTestApp();
    shop = await api.register('shop');
    other = await api.register('other');

    const panel = <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
      api.call<T>(method, `/stores/${shop.storeId}${url}`, shop, payload);

    const colors = (await panel<{ id: string; slug: string }[]>('GET', '/colors')).body;
    const sizes = (await panel<{ id: string; label: string }[]>('GET', '/sizes')).body;
    const colorId = (slug: string) => colors.find((c) => c.slug === slug)?.id;
    const sizeId = (label: string) => sizes.find((s) => s.label === label)?.id;

    const dresses = (await panel<{ id: string }>('POST', '/categories', { name: 'Vestidos' })).body;
    const hidden = (await panel<{ id: string }>('POST', '/categories', { name: 'Oculta' })).body;

    await panel('PATCH', `/categories/${hidden.id}`, { active: false });

    const create = async (
      key: string,
      body: object,
      matrices: { color: string; size: string; stock: number }[],
    ) => {
      const created = (await panel<PanelProduct>('POST', '/products', body)).body;

      for (const matrix of matrices) {
        await panel('POST', `/products/${created.id}/variants`, {
          colorIds: [colorId(matrix.color)],
          sizeIds: [sizeId(matrix.size)],
          defaultStock: matrix.stock,
        });
      }

      products[key] = (await panel<PanelProduct>('GET', `/products/${created.id}`)).body;
    };

    // Orden de creación = orden de "novedades" (la más nueva primero).
    await create(
      'dress',
      {
        name: 'Vestido Negro',
        basePrice: 100000,
        categoryId: dresses.id,
        status: 'ACTIVE',
        featured: true,
      },
      [
        { color: 'negro', size: 'M', stock: 5 },
        { color: 'blanco', size: 'S', stock: 0 },
      ],
    );
    await create('blouse', { name: 'Blusa Blanca', basePrice: 50000, status: 'ACTIVE' }, [
      { color: 'blanco', size: 'M', stock: 3 },
    ]);
    await create('draft', { name: 'Borrador', basePrice: 70000 }, [
      { color: 'negro', size: 'M', stock: 9 },
    ]);
    await create(
      'skirt',
      { name: 'Falda Escondida', basePrice: 80000, categoryId: hidden.id, status: 'ACTIVE' },
      [],
    );
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('catálogo', () => {
    it('solo lista lo publicado; el borrador no existe', async () => {
      const { status, body } = await pub<Page>('/products');

      expect(status).toBe(200);
      expect(body.total).toBe(3);
      expect(slugs(body.products)).toEqual(['falda-escondida', 'blusa-blanca', 'vestido-negro']);
    });

    it('ordena por precio', async () => {
      const { body } = await pub<Page>('/products?sort=price-asc');

      expect(slugs(body.products)).toEqual(['blusa-blanca', 'falda-escondida', 'vestido-negro']);
    });

    it('color y talla se evalúan sobre la misma variante, y solo con stock', async () => {
      expect(slugs((await pub<Page>('/products?colors=negro')).body.products)).toEqual([
        'vestido-negro',
      ]);
      // El blanco del vestido está en cero: solo la blusa tiene blanco para vender.
      expect(slugs((await pub<Page>('/products?colors=blanco')).body.products)).toEqual([
        'blusa-blanca',
      ]);
      expect((await pub<Page>('/products?colors=blanco&sizes=s')).body.total).toBe(0);
      expect((await pub<Page>('/products?sizes=m')).body.total).toBe(2);
    });

    it('una categoría oculta o inexistente deja la lista vacía', async () => {
      expect(slugs((await pub<Page>('/products?category=vestidos')).body.products)).toEqual([
        'vestido-negro',
      ]);
      expect((await pub<Page>('/products?category=oculta')).body.total).toBe(0);
      expect((await pub<Page>('/products?category=no-existe')).body.total).toBe(0);
    });

    it('filtra por precio y por nombre', async () => {
      expect(
        slugs((await pub<Page>('/products?minPrice=60000&maxPrice=90000')).body.products),
      ).toEqual(['falda-escondida']);
      expect(slugs((await pub<Page>('/products?q=BLUSA')).body.products)).toEqual(['blusa-blanca']);
    });

    it('rechaza un orden desconocido', async () => {
      expect((await pub('/products?sort=barato')).status).toBe(400);
    });

    it('la tarjeta resume colores y stock de las variantes activas', async () => {
      const { body } = await pub<Page>('/products');
      const dress = body.products.find((card) => card.slug === 'vestido-negro');
      const skirt = body.products.find((card) => card.slug === 'falda-escondida');

      expect(dress?.colors.map((color) => color.slug)).toEqual(['negro', 'blanco']);
      expect(dress?.inStock).toBe(true);
      expect(skirt).toMatchObject({ inStock: false, colors: [] });
    });

    it('las facetas solo ofrecen lo visible', async () => {
      const { body } = await pub<{
        categories: { slug: string }[];
        colors: unknown[];
        priceRange: { min: number; max: number };
      }>('/facets');

      expect(body.categories.map((category) => category.slug)).toEqual(['vestidos']);
      expect(body.colors).toHaveLength(3);
      expect(body.priceRange).toEqual({ min: 50000, max: 100000 });
    });
  });

  describe('ficha de prenda', () => {
    it('muestra variantes con su precio final', async () => {
      const { status, body } = await pub<{
        categorySlug: string | null;
        variants: { price: number; stock: number }[];
        colors: { slug: string }[];
        sizes: { label: string }[];
      }>('/products/vestido-negro');

      expect(status).toBe(200);
      expect(body.categorySlug).toBe('vestidos');
      expect(body.variants).toHaveLength(2);
      expect(body.variants.every((variant) => variant.price === 100000)).toBe(true);
      expect(body.colors.map((color) => color.slug)).toEqual(['negro', 'blanco']);
      expect(body.sizes.map((size) => size.label)).toEqual(['S', 'M']);
    });

    it('un borrador responde 404', async () => {
      expect((await pub('/products/borrador')).status).toBe(404);
    });

    it('una categoría oculta no se nombra en la ficha', async () => {
      const { body } = await pub<{ categoryName: string | null }>('/products/falda-escondida');

      expect(body.categoryName).toBeNull();
    });

    it('una variante desactivada desaparece de la ficha y de los filtros', async () => {
      const blouseVariant = products.blouse?.variants[0];

      await api.call('PATCH', `/stores/${shop.storeId}/variants/${blouseVariant?.id}`, shop, {
        active: false,
      });

      const detail = await pub<{ variants: unknown[] }>('/products/blusa-blanca');

      expect(detail.body.variants).toEqual([]);
      expect((await pub<Page>('/products?colors=blanco')).body.total).toBe(0);

      await api.call('PATCH', `/stores/${shop.storeId}/variants/${blouseVariant?.id}`, shop, {
        active: true,
      });
    });

    it('relacionadas: sin categoría visible, cualquier otra publicada', async () => {
      const { body } = await pub<Card[]>('/products/blusa-blanca/related');

      expect(slugs(body)).toEqual(['falda-escondida', 'vestido-negro']);
    });

    it('favoritos: fichas en el orden pedido, sin lo que no está publicado', async () => {
      const { status, body } = await api.call<Card[]>(
        'POST',
        `/public/${shop.slug}/products/lookup`,
        undefined,
        { slugs: ['blusa-blanca', 'borrador', 'vestido-negro', 'no-existe'] },
      );

      expect(status).toBe(200);
      expect(slugs(body)).toEqual(['blusa-blanca', 'vestido-negro']);
    });
  });

  describe('contenido', () => {
    beforeAll(async () => {
      // El panel todavía no administra colecciones: se siembran directo, con el
      // contexto de tienda puesto como exige RLS.
      await api.withOwner(async (client) => {
        await client.query('begin');
        await client.query(`select set_config('app.store_id', $1, true)`, [shop.storeId]);

        const { rows } = await client.query<{ id: string }>(
          `insert into collections (id, store_id, slug, name, active)
           values (gen_random_uuid(), $1, 'verano', 'Verano', true) returning id`,
          [shop.storeId],
        );

        await client.query(
          `insert into collection_products (store_id, collection_id, product_id, sort_order, hotspot_x, hotspot_y)
           values ($1, $2, $3, 0, 30.5, 40), ($1, $2, $4, 1, null, null)`,
          [shop.storeId, rows[0]?.id, products.dress?.id, products.draft?.id],
        );

        await client.query(
          `insert into collections (id, store_id, slug, name, active)
           values (gen_random_uuid(), $1, 'invierno', 'Invierno', false)`,
          [shop.storeId],
        );

        await client.query('commit');
      });
    });

    it('el layout recibe tienda, ajustes, categorías y colecciones visibles', async () => {
      const { status, body } = await pub<{
        store: { slug: string };
        settings: { whatsappPhone: string };
        categories: { slug: string }[];
        collections: { slug: string }[];
      }>('');

      expect(status).toBe(200);
      expect(body.store.slug).toBe(shop.slug);
      expect(body.settings.whatsappPhone).toBe('573001234567');
      expect(body.categories.map((category) => category.slug)).toEqual(['vestidos']);
      expect(body.collections.map((collection) => collection.slug)).toEqual(['verano']);
    });

    it('la portada separa destacadas y novedades', async () => {
      const { body } = await pub<{ featured: Card[]; newest: Card[]; highlights: unknown[] }>(
        '/home',
      );

      expect(slugs(body.featured)).toEqual(['vestido-negro']);
      expect(body.newest).toHaveLength(3);
      expect(body.highlights).toEqual([]);
    });

    it('una colección muestra solo prendas publicadas, con su posición', async () => {
      const { body } = await pub<{
        items: { hotspotX: number | null; hotspotY: number | null; product: Card }[];
      }>('/collections/verano');

      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        hotspotX: 30.5,
        hotspotY: 40,
        product: { slug: 'vestido-negro' },
      });
      expect((await pub('/collections/invierno')).status).toBe(404);
    });

    it('el sitemap lista solo slugs publicados', async () => {
      const { body } = await pub<{
        products: { slug: string }[];
        collections: string[];
        categories: string[];
      }>('/sitemap');

      expect(body.products.map((product) => product.slug).sort()).toEqual([
        'blusa-blanca',
        'falda-escondida',
        'vestido-negro',
      ]);
      expect(body.collections).toEqual(['verano']);
      expect(body.categories).toEqual(['vestidos']);
    });
  });

  describe('aviso de reposición', () => {
    const restock = (storeSlug: string, variantId: string | undefined, contact: string) =>
      api.call('POST', `/public/${storeSlug}/restock-requests`, undefined, { variantId, contact });

    it('queda guardado sobre una variante visible', async () => {
      const soldOut = products.dress?.variants.find((variant) => variant.color.slug === 'blanco');

      expect((await restock(shop.slug, soldOut?.id, '3001234567')).status).toBe(204);

      const { rows } = await api.withOwner((client) =>
        client.query<{ n: number }>(
          'select count(*)::int as n from restock_requests where store_id = $1',
          [shop.storeId],
        ),
      );

      expect(rows[0]?.n).toBe(1);
    });

    it('no acepta variantes de un borrador ni un contacto demasiado corto', async () => {
      expect((await restock(shop.slug, products.draft?.variants[0]?.id, '3001234567')).status).toBe(
        404,
      );
      expect((await restock(shop.slug, products.dress?.variants[0]?.id, 'abc')).status).toBe(400);
    });

    it('desde otra tienda, la variante no existe', async () => {
      expect(
        (await restock(other.slug, products.dress?.variants[0]?.id, '3001234567')).status,
      ).toBe(404);
    });
  });

  describe('aislamiento y estado de la tienda', () => {
    it('la ficha de una tienda no se ve desde el slug de otra', async () => {
      expect((await api.call('GET', `/public/${other.slug}/products/vestido-negro`)).status).toBe(
        404,
      );
    });

    it('un slug inexistente responde 404', async () => {
      expect((await api.call('GET', '/public/no-existe-esta-tienda')).status).toBe(404);
    });

    it('una tienda suspendida deja de responder', async () => {
      await api.withOwner((client) =>
        client.query(`update stores set status = 'SUSPENDED' where id = $1`, [shop.storeId]),
      );

      expect((await pub('')).status).toBe(404);
      expect((await pub('/products')).status).toBe(404);

      await api.withOwner((client) =>
        client.query(`update stores set status = 'ACTIVE' where id = $1`, [shop.storeId]),
      );
    });
  });
});
