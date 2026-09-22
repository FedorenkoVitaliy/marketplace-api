import dataSource, { logger } from './data-source.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'

dataSource.setOptions({ logger })
await dataSource.initialize()
const orders = dataSource.getRepository(Order)
const items = dataSource.getRepository(OrderItem)

logger.reset()
const list = await orders.find()
for (const order of list) {
    const rows = await items.find({
        where: { order: { id: order.id } },
        relations: ['product'],
    })
    void rows
}
const before = logger.count

logger.reset()
await orders.find({ relations: ['items', 'items.product'] })
const after = logger.count

console.log(before)
console.log(after)

await dataSource.destroy()
