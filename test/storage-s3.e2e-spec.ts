import { CreateBucketCommand, PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
import { S3MediaStorage } from '@shared/storage/s3-media-storage';

/**
 * El adaptador S3 contra un bucket real.
 *
 * Solo corre si el entorno trae credenciales (`S3_TEST_*`); sin ellas se
 * salta, para que la suite no dependa de tener un bucket a mano. En local se
 * corre contra MinIO:
 *
 *   podman run -d --name tienda-minio -p 9000:9000 \
 *     -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 \
 *     quay.io/minio/minio server /data
 *
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_BUCKET=tienda-media \
 *   S3_TEST_ACCESS_KEY_ID=minio S3_TEST_SECRET_ACCESS_KEY=minio12345 \
 *   pnpm test:e2e storage-s3
 */

const endpoint = process.env.S3_TEST_ENDPOINT;
const bucket = process.env.S3_TEST_BUCKET;
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY;

const configured = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);

(configured ? describe : describe.skip)('Almacenamiento S3 (e2e)', () => {
  const publicUrl = `${endpoint}/${bucket}`;
  const key = `stores/prueba/products/vestido/${Date.now().toString(36)}-thumb.webp`;

  let storage: S3MediaStorage;

  beforeAll(async () => {
    const options = {
      bucket: bucket ?? '',
      region: 'us-east-1',
      endpoint,
      accessKeyId: accessKeyId ?? '',
      secretAccessKey: secretAccessKey ?? '',
      publicUrl,
      forcePathStyle: true,
    };

    // El bucket con lectura pública, como estaría configurado en R2 o S3.
    const client = new S3Client({
      region: options.region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });

    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined);
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { AWS: ['*'] },
              Action: ['s3:GetObject'],
              Resource: [`arn:aws:s3:::${bucket}/*`],
            },
          ],
        }),
      }),
    );

    storage = new S3MediaStorage(options);
  });

  it('guarda, sirve en la URL pública con caché inmutable y borra', async () => {
    const body = Buffer.from('RIFF....WEBP', 'utf8');

    await storage.put([{ key, body, contentType: 'image/webp' }]);

    const url = storage.publicUrl(key);

    expect(url).toBe(`${publicUrl}/${key}`);

    const served = await fetch(url);

    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toContain('immutable');
    expect(Buffer.from(await served.arrayBuffer()).equals(body)).toBe(true);

    await storage.remove([key]);

    expect((await fetch(url)).status).toBe(404);

    // Borrar lo que ya no está no es un error.
    await expect(storage.remove([key])).resolves.toBeUndefined();
  });

  it('rechaza una clave que salga del bucket', () => {
    expect(() => storage.publicUrl('../otra-tienda/foto.webp')).toThrow();
  });
});
