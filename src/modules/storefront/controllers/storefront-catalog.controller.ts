import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  CatalogFacetsDto,
  ProductCardDto,
  ProductLookupDto,
  ProductPageDto,
  ProductSearchQueryDto,
  PublicProductDetailDto,
} from '@shared/dtos/storefront/product.dto';

import { StorefrontCatalogService } from '../providers/storefront-catalog.service';

/**
 * Catálogo público. Sin autenticación.
 *
 * Sin límite por IP, a propósito: la tienda llama a esta API desde su servidor,
 * así que todas las visitantes llegan con la misma IP y un límite por IP
 * terminaría frenando a la tienda entera. Son lecturas; lo que hay que acotar
 * son las escrituras públicas, y esas llevan su propio `@Throttle`.
 */
@ApiTags('tienda pública')
@SkipThrottle()
@Controller('public/:storeSlug')
export class StorefrontCatalogController {
  constructor(private readonly catalog: StorefrontCatalogService) {}

  @Get('products')
  @ApiOperation({ summary: 'Listado de productos publicadas con filtros, orden y páginas de 12.' })
  search(
    @Param('storeSlug') storeSlug: string,
    @Query() query: ProductSearchQueryDto,
  ): Promise<ProductPageDto> {
    return this.catalog.search(storeSlug, query);
  }

  @Get('facets')
  @ApiOperation({
    summary: 'Opciones para los filtros: categorías, colores, variaciones y precios.',
  })
  facets(@Param('storeSlug') storeSlug: string): Promise<CatalogFacetsDto> {
    return this.catalog.facets(storeSlug);
  }

  @Post('products/lookup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fichas frescas para una lista de slugs (favoritos), en ese orden.' })
  lookup(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: ProductLookupDto,
  ): Promise<ProductCardDto[]> {
    return this.catalog.lookup(storeSlug, dto.slugs);
  }

  @Get('products/:productSlug')
  @ApiOperation({ summary: 'Ficha de un producto publicada, con sus variantes activas.' })
  detail(
    @Param('storeSlug') storeSlug: string,
    @Param('productSlug') productSlug: string,
  ): Promise<PublicProductDetailDto> {
    return this.catalog.detail(storeSlug, productSlug);
  }

  @Get('products/:productSlug/related')
  @ApiOperation({ summary: 'Hasta 4 productos relacionadas.' })
  related(
    @Param('storeSlug') storeSlug: string,
    @Param('productSlug') productSlug: string,
  ): Promise<ProductCardDto[]> {
    return this.catalog.related(storeSlug, productSlug);
  }
}
