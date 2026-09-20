import { Module } from '@nestjs/common';

import { CategoriesController } from './controllers/categories.controller';
import { InventoryController } from './controllers/inventory.controller';
import { ProductImagesController } from './controllers/product-images.controller';
import { ProductOptionsController } from './controllers/product-options.controller';
import { ProductsController } from './controllers/products.controller';
import { VariantsController } from './controllers/variants.controller';
import { CategoriesService } from './providers/categories.service';
import { InventoryService } from './providers/inventory.service';
import { ProductImagesService } from './providers/product-images.service';
import { ProductOptionsService } from './providers/product-options.service';
import { ProductsService } from './providers/products.service';
import { VariantsService } from './providers/variants.service';

/**
 * Catálogo del panel: lo que la dueña administra de su tienda.
 *
 * No importa `AuthModule` aunque use sus guards, y es a propósito: los guards
 * viven en `shared/` y Nest los instancia con lo que hay en el alcance de este
 * módulo (PrismaService es global). Importar otro módulo de dominio rompería la
 * regla de ARCHITECTURE.md § 6.
 *
 * Las fotos se registran, ordenan y quitan aquí, pero el archivo no pasa por la
 * API todavía: procesar con `sharp` y escribir en el almacenamiento es la fase
 * de medios. Ver ProductImagesService.
 */
@Module({
  controllers: [
    CategoriesController,
    ProductsController,
    ProductOptionsController,
    VariantsController,
    InventoryController,
    ProductImagesController,
  ],
  providers: [
    CategoriesService,
    ProductsService,
    ProductOptionsService,
    VariantsService,
    InventoryService,
    ProductImagesService,
  ],
})
export class CatalogModule {}
