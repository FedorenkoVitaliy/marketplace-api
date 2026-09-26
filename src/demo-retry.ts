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

boots.stock = 2
await products.save(boots)
const balanceBefore = buyer.balance

await Promise.all([
  withRetry(() => checkout({ userId: buyer.id, productId: boots.id, qty: 1, delayMs: 150 })),
  withRetry(() => checkout({ userId: buyer.id, productId: boots.id, qty: 1, delayMs: 250 })),
])

const after = await products.findOneByOrFail({ id: boots.id })
const buyerAfter = await users.findOneByOrFail({ id: buyer.id })
const expectedBalance = balanceBefore - 2 * boots.price
console.log(`фінал stock = ${after.stock} (очікували 0)`)
console.log(`баланс ${balanceBefore} → ${buyerAfter.balance} (очікували ${expectedBalance})`)

await dataSource.destroy()
process.exit(after.stock === 0 && buyerAfter.balance === expectedBalance ? 0 : 1)
