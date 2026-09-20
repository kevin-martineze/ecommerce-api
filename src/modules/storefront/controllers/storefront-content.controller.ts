import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  CreateRestockRequestDto,
  HomeDto,
  PublicCollectionDetailDto,
  SitemapDto,
  StorefrontDto,
} from '@shared/dtos/storefront/content.dto';

import { StorefrontContentService } from '../providers/storefront-content.service';

/** Contenido público de la tienda. Sin autenticación; ver la nota de límites en StorefrontCatalogController. */
@ApiTags('tienda pública')
@SkipThrottle()
@Controller('public/:storeSlug')
export class StorefrontContentController {
  constructor(private readonly content: StorefrontContentService) {}

  @Get()
  @ApiOperation({ summary: 'Tienda, ajustes, categorías y colecciones: lo que pide el layout.' })
  storefront(@Param('storeSlug') storeSlug: string): Promise<StorefrontDto> {
    return this.content.storefront(storeSlug);
  }

  @Get('home')
  @ApiOperation({ summary: 'Portada: destacadas, novedades y bloques de texto.' })
  home(@Param('storeSlug') storeSlug: string): Promise<HomeDto> {
    return this.content.home(storeSlug);
  }

  @Get('collections/:collectionSlug')
  @ApiOperation({ summary: 'Una colección con sus prendas publicadas y la posición de cada una.' })
  collection(
    @Param('storeSlug') storeSlug: string,
    @Param('collectionSlug') collectionSlug: string,
  ): Promise<PublicCollectionDetailDto> {
    return this.content.collection(storeSlug, collectionSlug);
  }

  @Get('sitemap')
  @ApiOperation({ summary: 'Slugs publicados, para armar el sitemap.' })
  sitemap(@Param('storeSlug') storeSlug: string): Promise<SitemapDto> {
    return this.content.sitemap(storeSlug);
  }

  /**
   * La única escritura pública de esta superficie, y por eso la única con
   * límite. La IP que cuenta es la de la visitante, que la tienda reenvía en
   * `X-Forwarded-For`; sin eso, todas compartirían la cuota del servidor.
   */
  @Post('restock-requests')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Pide aviso cuando vuelva una talla agotada.' })
  async requestRestock(
    @Param('storeSlug') storeSlug: string,
    @Body() dto: CreateRestockRequestDto,
  ): Promise<void> {
    await this.content.requestRestock(storeSlug, dto);
  }
}
