import { Module } from '@nestjs/common';

import { CategoriesController } from './controllers/categories.controller';
import { ColorsController } from './controllers/colors.controller';
import { InventoryController } from './controllers/inventory.controller';
import { ProductImagesController } from './controllers/product-images.controller';
import { ProductsController } from './controllers/products.controller';
import { SizesController } from './controllers/sizes.controller';
import { VariantsController } from './controllers/variants.controller';
import { CategoriesService } from './providers/categories.service';
import { ColorsService } from './providers/colors.service';
import { InventoryService } from './providers/inventory.service';
import { ProductImagesService } from './providers/product-images.service';
import { ProductsService } from './providers/products.service';
import { SizesService } from './providers/sizes.service';
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
    ColorsController,
    SizesController,
    CategoriesController,
    ProductsController,
    VariantsController,
    InventoryController,
    ProductImagesController,
  ],
  providers: [
    ColorsService,
    SizesService,
    CategoriesService,
    ProductsService,
    VariantsService,
    InventoryService,
    ProductImagesService,
  ],
})
export class CatalogModule {}
