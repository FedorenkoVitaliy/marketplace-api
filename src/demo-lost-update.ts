import dataSource from './data-source.js'
import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import { checkout } from './checkout.js'

await dataSource.initialize()

const users = dataSource.getRepository(User)
const products = dataSource.getRepository(Product)
const buyer = await users.findOneByOrFail({ email: 'buyer@shop.test' })
const boots = await products.findOneByOrFail({ name: 'Шкіряні кросівки' })

boots.stock = 2
await products.save(boots)

await Promise.all([
  checkout({ userId: buyer.id, productId: boots.id, qty: 1, delayMs: 150 }),
  checkout({ userId: buyer.id, productId: boots.id, qty: 1, delayMs: 250 }),
])

const after = await products.findOneByOrFail({ id: boots.id })
console.log(`фінал stock = ${after.stock} (очікували 0)`)

await dataSource.destroy()
