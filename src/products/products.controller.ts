import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles, RolesGuard } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { ProductsService, type CreateProduct } from './products.service.js';

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

    @Post()
    @HttpCode(201)
    @UseGuards(AuthGuard, RolesGuard)
    @Roles('seller', 'admin')
    create(@Body() body: CreateProduct, @CurrentUser() user: AuthUser) {
        return this.products.create(user.id, body);
    }
}
