import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { Env } from '@shared/config/env';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === 'production';

  /**
   * En desarrollo el log va formateado y legible; en producción, JSON en una
   * línea, que es lo que sabe indexar el agregador de logs. `pino-pretty` es
   * dependencia de desarrollo, así que no puede quedar activo en producción.
   */
  const adapter = new FastifyAdapter({
    logger: isProduction
      ? { level: 'info' }
      : {
          level: 'debug',
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
    // Las imágenes de producto NO entran por aquí como base64: se suben como
    // multipart en la fase de medios. Este techo es para cuerpos JSON, y 1 MB
    // ya es generoso para el pedido más grande.
    bodyLimit: 1024 * 1024,
    // Detrás del proxy del hosting la IP real llega en `X-Forwarded-For`. Sin
    // esto, el límite por IP vería a todo internet como un solo visitante y el
    // primero en comprar consumiría la cuota de los demás.
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter);

  /**
   * Los plugins se registran sobre la app, no sobre el adapter.
   *
   * Registrarlos en el FastifyAdapter compila mal: su firma de `register`
   * está tipada contra `RawServerBase`, que admite HTTP/2, mientras que los
   * plugins declaran `RawServerDefault`. La app de Nest expone la instancia
   * ya concreta y los tipos encajan. Corren antes de `listen`, así que sus
   * hooks quedan puestos antes de que entre la primera petición.
   */
  await app.register(fastifyHelmet, {
    // Swagger UI carga scripts y estilos en línea que la CSP por defecto
    // bloquea. La documentación solo se monta fuera de producción, así que la
    // excepción vive y muere con ella.
    contentSecurityPolicy: isProduction ? undefined : false,
  });
  await app.register(fastifyCompress);
  await app.register(fastifyCookie, {
    // Firma la cookie del refresh token. La validación de entorno ya garantiza
    // que existe y que tiene largo suficiente.
    secret: process.env.COOKIE_SECRET,
  });

  const config = app.get(ConfigService<Env, true>);

  const apiPrefix = config.get('API_PREFIX', { infer: true });
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.setGlobalPrefix(apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      // `whitelist` descarta lo que no está en el DTO; `forbidNonWhitelisted`
      // además lo rechaza con 400. Es la diferencia entre ignorar en silencio
      // un campo que el cliente creía estar mandando y decírselo.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // `credentials` porque el refresh token viaja en cookie. La lista de orígenes
  // se valida en el entorno; vacía significa que nadie cruza, y eso está bien:
  // el frontend habla con esta API servidor contra servidor, sin navegador.
  app.enableCors({ origin: corsOrigins, credentials: true });

  // Cierra conexiones de Postgres al recibir SIGTERM en vez de dejarlas colgando.
  app.enableShutdownHooks();

  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Tienda — API')
        .setDescription(
          'API multi-inquilino. Tres superficies:\n\n' +
            '- `/public/:storeSlug/*` — catálogo y pedidos del visitante. Sin autenticación.\n' +
            '- `/stores/:storeId/*` — panel de la tienda. Requiere sesión Y membresía en esa tienda.\n' +
            '- `/platform/*` — administración de la plataforma. Solo administradores.',
        )
        .setVersion('0.1')
        .addBearerAuth()
        .build(),
    );

    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');

  logger.log(`API escuchando en http://localhost:${port}/${apiPrefix}`);

  if (!isProduction) {
    logger.log(`Documentación en http://localhost:${port}/${apiPrefix}/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  logger.error('La API no pudo arrancar', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
