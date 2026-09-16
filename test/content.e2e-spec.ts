import { Method, Session, startTestApp, TestApp } from './utils/test-app';

/**
 * Contenido que administra el panel y se ve en la tienda: ajustes, portada,
 * colecciones y fotos de prenda.
 *
 * Cada escritura del panel se comprueba también desde la superficie pública:
 * el punto de estos endpoints es que lo que la dueña edita llegue a la tienda.
 */

jest.setTimeout(30_000);

interface CollectionBody {
  id: string;
  slug: string;
  items: { productId: string; hotspotX: number | null }[];
}

interface ImageBody {
  id: string;
  sortOrder: number;
  storagePath: string;
}

const photo = (name: string) => ({
  storagePath: `productos/prueba/${name}`,
  urlFull: `https://cdn.tienda.test/${name}-full.webp`,
  urlCard: `https://cdn.tienda.test/${name}-card.webp`,
  urlThumb: `https://cdn.tienda.test/${name}-thumb.webp`,
  lqip: 'data:image/webp;base64,UklGRiQAAABXRUJQ',
});

describe('Contenido de la tienda y fotos (e2e)', () => {
  let api: TestApp;
  let shop: Session;
  let other: Session;
  let productId: string;
  let otherProductId: string;

  const panel = <T>(method: Method, url: string, payload?: object, session: Session = shop) =>
    api.call<T>(method, `/stores/${session.storeId}${url}`, session, payload);

  const pub = <T>(url: string) => api.call<T>('GET', `/public/${shop.slug}${url}`);

  beforeAll(async () => {
    api = await startTestApp();
    shop = await api.register('content');
    other = await api.register('content-other');

    productId = (
      await panel<{ id: string }>('POST', '/products', {
        name: 'Vestido Portada',
        basePrice: 120000,
        status: 'ACTIVE',
      })
    ).body.id;

    otherProductId = (
      await panel<{ id: string }>(
        'POST',
        '/products',
        { name: 'Ajena', basePrice: 1000, status: 'ACTIVE' },
        other,
      )
    ).body.id;
  });

  afterAll(async () => {
    await api?.close();
  });

  describe('ajustes', () => {
    it('lee los ajustes con los que nació la tienda', async () => {
      const { status, body } = await panel<{ storeName: string; whatsappPhone: string }>(
        'GET',
        '/settings',
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ storeName: 'Tienda content', whatsappPhone: '573001234567' });
    });

    it('lo que se guarda llega a la tienda pública; vacío quita el valor', async () => {
      await panel('PATCH', '/settings', { instagramUrl: 'https://instagram.com/atelier' });

      const { status } = await panel('PATCH', '/settings', {
        storeName: 'Atelier Norte',
        announcement: 'Envío gratis desde $200.000',
        instagramUrl: '',
      });

      expect(status).toBe(200);

      const { body } = await pub<{
        store: { name: string };
        settings: { announcement: string | null; instagramUrl: string | null };
      }>('');

      expect(body.store.name).toBe('Atelier Norte');
      expect(body.settings).toMatchObject({
        announcement: 'Envío gratis desde $200.000',
        instagramUrl: null,
      });
    });

    it('rechaza un WhatsApp con símbolos y una colección de otra tienda', async () => {
      expect((await panel('PATCH', '/settings', { whatsappPhone: '+57 300' })).status).toBe(400);

      const foreign = await panel<CollectionBody>('POST', '/collections', { name: 'Ajena' }, other);

      expect(
        (await panel('PATCH', '/settings', { heroCollectionId: foreign.body.id })).status,
      ).toBe(400);
    });
  });

  describe('bloques de portada', () => {
    it('crear, ocultar y borrar se reflejan en la portada pública', async () => {
      const created = await panel<{ id: string }>('POST', '/home-highlights', {
        eyebrow: 'Envíos',
        title: 'A todo el país',
        body: 'Calculamos el costo antes de confirmar.',
      });

      expect(created.status).toBe(201);

      const home = async () => (await pub<{ highlights: { id: string }[] }>('/home')).body;

      expect((await home()).highlights.map((h) => h.id)).toEqual([created.body.id]);

      await panel('PATCH', `/home-highlights/${created.body.id}`, { active: false });

      expect((await home()).highlights).toEqual([]);
      expect((await panel<unknown[]>('GET', '/home-highlights')).body).toHaveLength(1);

      expect((await panel('DELETE', `/home-highlights/${created.body.id}`)).status).toBe(204);
      expect((await panel('DELETE', `/home-highlights/${created.body.id}`)).status).toBe(404);
    });
  });

  describe('colecciones', () => {
    let collection: CollectionBody;

    it('crea con slug derivado; un slug repetido escrito a mano es 409', async () => {
      const created = await panel<CollectionBody>('POST', '/collections', {
        name: 'Verano Norte',
        heroImageUrl: 'https://cdn.tienda.test/verano-a-full.webp',
        heroStoragePath: 'colecciones/verano-norte/a',
      });

      expect(created.status).toBe(201);
      expect(created.body.slug).toBe('verano-norte');

      collection = created.body;

      const repeated = await panel<{ message: string }>('POST', '/collections', {
        name: 'Otra',
        slug: 'verano-norte',
      });

      expect(repeated.status).toBe(409);
      expect(repeated.body.message).toBe('Ya existe una colección con ese slug.');
    });

    it('la foto necesita URL y ruta juntas', async () => {
      expect(
        (
          await panel('PATCH', `/collections/${collection.id}`, {
            heroImageUrl: 'https://cdn.tienda.test/solo-url.webp',
          })
        ).status,
      ).toBe(400);
    });

    it('etiqueta una prenda y mueve su punto sin duplicarla', async () => {
      const url = `/collections/${collection.id}/products/${productId}`;

      expect((await panel('PUT', url, { hotspotX: 25.5, hotspotY: 60 })).status).toBe(200);

      const moved = await panel<CollectionBody>('PUT', url, { hotspotX: 10 });

      expect(moved.body.items).toEqual([expect.objectContaining({ productId, hotspotX: 10 })]);

      const detail = await pub<{ items: { hotspotX: number; hotspotY: number }[] }>(
        '/collections/verano-norte',
      );

      expect(detail.body.items).toEqual([expect.objectContaining({ hotspotX: 10, hotspotY: 60 })]);
    });

    it('no etiqueta prendas de otra tienda ni puntos fuera de la foto', async () => {
      const base = `/collections/${collection.id}/products`;

      expect((await panel('PUT', `${base}/${otherProductId}`, {})).status).toBe(400);
      expect((await panel('PUT', `${base}/${productId}`, { hotspotX: 120 })).status).toBe(400);
    });

    it('reemplazar la foto devuelve la ruta de la anterior', async () => {
      const { body } = await panel<{ replacedHeroStoragePath: string | null }>(
        'PATCH',
        `/collections/${collection.id}`,
        {
          heroImageUrl: 'https://cdn.tienda.test/verano-b-full.webp',
          heroStoragePath: 'colecciones/verano-norte/b',
        },
      );

      expect(body.replacedHeroStoragePath).toBe('colecciones/verano-norte/a');
    });

    it('quitar la prenda; quitarla de nuevo es 404', async () => {
      const url = `/collections/${collection.id}/products/${productId}`;

      expect((await panel('DELETE', url)).status).toBe(204);
      expect((await panel('DELETE', url)).status).toBe(404);
    });

    it('borrar la colección devuelve su foto y la portada vuelve a los textos', async () => {
      await panel('PATCH', '/settings', { heroCollectionId: collection.id });

      const before = await pub<{ settings: { heroCollectionId: string | null } }>('');

      expect(before.body.settings.heroCollectionId).toBe(collection.id);

      const removed = await panel<{ storagePaths: string[] }>(
        'DELETE',
        `/collections/${collection.id}`,
      );

      expect(removed.body.storagePaths).toEqual(['colecciones/verano-norte/b']);

      const after = await pub<{ settings: { heroCollectionId: string | null } }>('');

      expect(after.body.settings.heroCollectionId).toBeNull();
    });
  });

  describe('fotos de prenda', () => {
    let first: ImageBody;
    let second: ImageBody;

    const publicImages = async () =>
      (await pub<{ images: { id: string }[] }>('/products/vestido-portada')).body.images.map(
        (image) => image.id,
      );

    it('las fotos nuevas van al final', async () => {
      first = (await panel<ImageBody>('POST', `/products/${productId}/images`, photo('uno'))).body;
      second = (await panel<ImageBody>('POST', `/products/${productId}/images`, photo('dos'))).body;

      expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);
      expect(await publicImages()).toEqual([first.id, second.id]);
    });

    it('no acepta el color de otra tienda ni una URL inválida', async () => {
      const otherColors = (await panel<{ id: string }[]>('GET', '/colors', undefined, other)).body;

      expect(
        (
          await panel('POST', `/products/${productId}/images`, {
            ...photo('tres'),
            colorId: otherColors[0]?.id,
          })
        ).status,
      ).toBe(400);

      expect(
        (
          await panel('POST', `/products/${productId}/images`, {
            ...photo('cuatro'),
            urlFull: 'no-es-una-url',
          })
        ).status,
      ).toBe(400);
    });

    it('reordenar cambia la principal; una lista incompleta es 400', async () => {
      const url = `/products/${productId}/images/order`;

      expect((await panel('PUT', url, { imageIds: [second.id, first.id] })).status).toBe(200);
      expect(await publicImages()).toEqual([second.id, first.id]);
      expect((await panel('PUT', url, { imageIds: [second.id] })).status).toBe(400);
    });

    it('quitar una foto devuelve su ruta; desde otra tienda no existe', async () => {
      expect((await panel('DELETE', `/product-images/${second.id}`, undefined, other)).status).toBe(
        404,
      );

      const removed = await panel<{ storagePath: string }>('DELETE', `/product-images/${first.id}`);

      expect(removed.body.storagePath).toBe('productos/prueba/uno');
      expect(await publicImages()).toEqual([second.id]);
    });
  });
});
