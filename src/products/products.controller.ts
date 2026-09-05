import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
    constructor(private readonly products: ProductsService) {}

    @Get()
    list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
        return this.products.list(limit, cursor);
    }

    @Get(':id')
    getById(@Param('id') id: string) {
        return this.products.findById(Number(id));
    }
}
