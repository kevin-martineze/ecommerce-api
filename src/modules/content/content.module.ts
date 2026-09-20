import { Module } from '@nestjs/common';

import { CollectionsController } from './controllers/collections.controller';
import { HomeHighlightsController } from './controllers/home-highlights.controller';
import { StoreSettingsController } from './controllers/store-settings.controller';
import { CollectionsService } from './providers/collections.service';
import { HomeHighlightsService } from './providers/home-highlights.service';
import { StoreSettingsService } from './providers/store-settings.service';

/**
 * Contenido de la tienda que administra la dueña: ajustes, portada y
 * colecciones. Es lo que la tienda pública muestra además del catálogo.
 */
@Module({
  controllers: [StoreSettingsController, HomeHighlightsController, CollectionsController],
  providers: [StoreSettingsService, HomeHighlightsService, CollectionsService],
})
export class ContentModule {}
