import dataSource from './data-source.js'
import { Product } from './entities/product.entity.js'

await dataSource.initialize()

const rows = await dataSource
  .getRepository(Product)
  .createQueryBuilder('p')
  .innerJoin('p.seller', 's')
  .innerJoin('order_items', 'i', 'i.product_id = p.id')
  .select('s.email', 'seller')
  .addSelect('SUM(i.qty * i.unit_price)', 'revenue_cents')
  .groupBy('s.id')
  .addGroupBy('s.email')
  .getRawMany()
console.log(rows)

await dataSource.destroy()