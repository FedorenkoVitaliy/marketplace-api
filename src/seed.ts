import dataSource from './data-source.js'
import { User } from './entities/user.entity.js'
import { Product } from './entities/product.entity.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'

await dataSource.initialize()

const userNames = ['seller', 'buyer', 'client'];
const users = dataSource.getRepository(User);
for (const userName of userNames) {
    const email = `${userName}@shop.test`
    let user = await users.findOne({ where: { email } })
    if (!user) {
        user = users.create({ email })
      }
    await users.save(user)
}

const seller = await users.findOneByOrFail({ email: 'seller@shop.test' })
const products = dataSource.getRepository(Product);
const catalog = [
    { name: 'Шкіряні кросівки', description: 'Демісезонні', price: 129900 },
    { name: 'Зимова куртка', description: 'Пухова', price: 450000 },
    { name: 'Рюкзак', description: 'Міський', price: 89000 },
  ]
  for (const row of catalog) {
    let product = await products.findOne({ where: { name: row.name } })
    if (!product) {
      product = products.create({ ...row, seller })
    }
    await products.save(product)
  }

const buyer = await users.findOneByOrFail({ email: 'buyer@shop.test' })
const client = await users.findOneByOrFail({ email: 'client@shop.test' })
const boots = await products.findOneByOrFail({ name: 'Шкіряні кросівки' })
const jacket = await products.findOneByOrFail({ name: 'Зимова куртка' })
const backpack = await products.findOneByOrFail({ name: 'Рюкзак' })
const orders = dataSource.getRepository(Order)
const items = dataSource.getRepository(OrderItem)
const tickets = [
    { user: buyer, status: 'pending', created_at: new Date('2024-01-15T12:00:00Z'), product: boots, qty: 1 },
    { user: buyer, status: 'completed', created_at: new Date('2024-02-01T09:00:00Z'), product: jacket, qty: 1 },
    { user: client, status: 'pending', created_at: new Date('2024-03-10T18:00:00Z'), product: backpack, qty: 2 },
]
for (const row of tickets) {
    let order = await orders.findOne({ where: { user: { id: row.user.id }, status: row.status } })
    if (!order) {
        order = orders.create({
            user: row.user,
            status: row.status,
            created_at: row.created_at,
        })
        await orders.save(order)
    }
    let item = await items.findOne({ where: { order: { id: order.id }, product: { id: row.product.id } } })
    if (!item) {
        item = items.create({
            order,
            product: row.product,
            qty: row.qty,
            unit_price: row.product.price,
        })
        await items.save(item)
    }
}

await dataSource.destroy()