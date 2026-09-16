import { existsSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';

import { Method, Session, startTestApp, TestApp, TestFile } from './utils/test-app';

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
  urlFull: string;
  lqip: string | null;
  alt: string | null;
}

/** Una foto real, generada con sharp: un PNG de un color. */
async function photo(width = 1200, height = 1600): Promise<TestFile> {
  const data = await sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();

  return { field: 'file', filename: 'foto.png', contentType: 'image/png', data };
}

const notAnImage: TestFile = {
  field: 'file',
  filename: 'foto.png',
  contentType: 'image/png',
  data: Buffer.from('esto no es una imagen'),
};

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
    let collectionHero = '';

    it('crea con slug derivado; un slug repetido escrito a mano es 409', async () => {
      const created = await panel<CollectionBody>('POST', '/collections', {
        name: 'Verano Norte',
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

    it('sube la foto de portada y la reemplaza borrando la anterior', async () => {
      const heroUrl = `/stores/${shop.storeId}/collections/${collection.id}/hero`;
      const first = await api.upload<{ heroImageUrl: string; heroStoragePath: string }>(
        'PUT',
        heroUrl,
        shop,
        await photo(),
      );

      expect(first.status).toBe(200);
      expect(first.body.heroStoragePath).toMatch(
        new RegExp(`^stores/${shop.storeId}/collections/verano-norte/`),
      );
      expect(first.body.heroImageUrl).toContain(`${first.body.heroStoragePath}-full.webp`);
      expect(storedFiles(first.body.heroStoragePath)).toEqual([true, true, true]);

      const second = await api.upload<{ heroStoragePath: string }>(
        'PUT',
        heroUrl,
        shop,
        await photo(),
      );

      expect(second.status).toBe(200);
      expect(storedFiles(first.body.heroStoragePath)).toEqual([false, false, false]);
      expect(storedFiles(second.body.heroStoragePath)).toEqual([true, true, true]);

      collectionHero = second.body.heroStoragePath;
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

    it('quitar la prenda; quitarla de nuevo es 404', async () => {
      const url = `/collections/${collection.id}/products/${productId}`;

      expect((await panel('DELETE', url)).status).toBe(204);
      expect((await panel('DELETE', url)).status).toBe(404);
    });

    it('borrar la colección borra su foto y la portada vuelve a los textos', async () => {
      await panel('PATCH', '/settings', { heroCollectionId: collection.id });

      const before = await pub<{ settings: { heroCollectionId: string | null } }>('');

      expect(before.body.settings.heroCollectionId).toBe(collection.id);

      expect((await panel('DELETE', `/collections/${collection.id}`)).status).toBe(204);
      expect(storedFiles(collectionHero)).toEqual([false, false, false]);

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

    const uploadPhoto = (fields: Record<string, string> = {}, file?: TestFile) =>
      api.upload<ImageBody>(
        'POST',
        `/stores/${shop.storeId}/products/${productId}/images`,
        shop,
        file ?? notAnImage,
        fields,
      );

    it('convierte la foto, la guarda y la registra al final', async () => {
      first = (await uploadPhoto({ alt: 'De frente' }, await photo())).body;
      second = (await uploadPhoto({}, await photo(800, 600))).body;

      expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);
      expect(first.alt).toBe('De frente');
      expect(second.alt).toBe('Vestido Portada');
      expect(first.lqip).toMatch(/^data:image\/webp;base64,/);
      expect(first.storagePath).toMatch(
        new RegExp(`^stores/${shop.storeId}/products/vestido-portada/`),
      );
      expect(storedFiles(first.storagePath)).toEqual([true, true, true]);
      expect(await publicImages()).toEqual([first.id, second.id]);

      // Los tres anchos salen de verdad: 1600 no agranda una foto de 800.
      const full = await sharp(join(api.mediaDir, `${second.storagePath}-full.webp`)).metadata();
      const thumb = await sharp(join(api.mediaDir, `${first.storagePath}-thumb.webp`)).metadata();

      expect(full.width).toBe(800);
      expect(thumb.width).toBe(400);
    });

    it('rechaza lo que no es imagen y el color de otra tienda, sin dejar archivos', async () => {
      const otherColors = (await panel<{ id: string }[]>('GET', '/colors', undefined, other)).body;

      const garbage = await uploadPhoto();
      const foreignColor = await uploadPhoto({ colorId: otherColors[0]?.id ?? '' }, await photo());

      expect(garbage.status).toBe(400);
      expect(foreignColor.status).toBe(400);
      expect(await publicImages()).toEqual([first.id, second.id]);
    });

    it('respeta el límite de fotos por prenda del plan', async () => {
      await api.withOwner((client) =>
        client.query(
          `update plans set max_images_per_product = 2 where code = (select plan_code from subscriptions where store_id = $1)`,
          [shop.storeId],
        ),
      );

      try {
        const { status, body } = await uploadPhoto({}, await photo());

        expect(status).toBe(403);
        expect(body).toMatchObject({ error: 'plan_limit' });
      } finally {
        await api.withOwner((client) =>
          client.query(
            `update plans set max_images_per_product = 6 where code = (select plan_code from subscriptions where store_id = $1)`,
            [shop.storeId],
          ),
        );
      }
    });

    it('reordenar cambia la principal; una lista incompleta es 400', async () => {
      const url = `/products/${productId}/images/order`;

      expect((await panel('PUT', url, { imageIds: [second.id, first.id] })).status).toBe(200);
      expect(await publicImages()).toEqual([second.id, first.id]);
      expect((await panel('PUT', url, { imageIds: [second.id] })).status).toBe(400);
    });

    it('quitar una foto borra sus archivos; desde otra tienda no existe', async () => {
      expect((await panel('DELETE', `/product-images/${second.id}`, undefined, other)).status).toBe(
        404,
      );

      expect((await panel('DELETE', `/product-images/${first.id}`)).status).toBe(204);
      expect(storedFiles(first.storagePath)).toEqual([false, false, false]);
      expect(await publicImages()).toEqual([second.id]);
    });

    it('borrar la prenda borra las fotos que quedaban', async () => {
      expect((await panel('DELETE', `/products/${productId}`)).status).toBe(200);
      expect(storedFiles(second.storagePath)).toEqual([false, false, false]);
    });
  });

  /** Si existen los tres anchos de una foto en el disco de esta prueba. */
  function storedFiles(storagePath: string): boolean[] {
    return ['thumb', 'card', 'full'].map((size) =>
      existsSync(join(api.mediaDir, `${storagePath}-${size}.webp`)),
    );
  }
});
