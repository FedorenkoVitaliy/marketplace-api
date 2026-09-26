import dataSource from './data-source.js'
import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import { checkout } from './checkout.js'
import { withRetry } from './lib/retry.js'

await dataSource.initialize()

const users = dataSource.getRepository(User)
const products = dataSource.getRepository(Product)
const buyer = await users.findOneByOrFail({ email: 'buyer@shop.test' })
const boots = await products.findOneByOrFail({ name: 'Шкіряні кросівки' })

boots.stock = 5
await products.save(boots)

const results = await Promise.allSettled(
  Array.from({ length: 10 }, async() =>
    await withRetry(() => checkout({ userId: buyer.id, productId: boots.id, qty: 1 }))
  ),
)

const ok = results.filter((r) => r.status === 'fulfilled').length
const fail = results.filter((r) => r.status === 'rejected').length
const after = await products.findOneByOrFail({ id: boots.id })

console.log(`успіхів ${ok}, відмов ${fail}, фінал stock = ${after.stock}`)

await dataSource.destroy()
