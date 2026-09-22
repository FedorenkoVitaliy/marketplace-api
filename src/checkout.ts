import dataSource from './data-source.js'
import { User } from './entities/user.entity.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'
import { Product } from './entities/product.entity.js'


export async function checkout({ userId, productId, qty, delayMs = 0 }: { userId: string; productId: string; qty: number, delayMs?: number }) {
    const qr = dataSource.createQueryRunner()
    await qr.connect()
    await qr.startTransaction()

    try { 
        const users = qr.manager.getRepository(User);
        const orders = qr.manager.getRepository(Order);
        const orderItems = qr.manager.getRepository(OrderItem);
        const products = qr.manager.getRepository(Product);
        const product = await products.findOneOrFail({
            where: { id: productId },
            lock: { mode: 'pessimistic_write' },
          })
        console.log(`прочитав stock = ${product.stock}`);

        if (product.stock < qty ){
            throw new Error('out of stock');
        }
    
        if (delayMs) {
            await new Promise((r) => setTimeout(r, delayMs))
        }
        product.stock -= qty
        await products.save(product)
    
        const user = await users.findOneByOrFail({ id: userId });
        const order = orders.create({
            user,
            status: 'completed',
            created_at: new Date(),
          })
        await orders.save(order)
    
        const item = orderItems.create({
            order,
            product,
            qty,
            unit_price: product.price,
        })
        await orderItems.save(item)
        await qr.commitTransaction()
    } catch (e) {
        await qr.rollbackTransaction()
        throw e
    } finally {
        await qr.release()
    }
}

if (process.argv[1]?.includes('checkout')) {
    await dataSource.initialize()

    const users = dataSource.getRepository(User)
    const products = dataSource.getRepository(Product)
    const buyer = await users.findOneByOrFail({ email: 'buyer@shop.test' });
    const boots = await products.findOneByOrFail({ name: 'Шкіряні кросівки'});
    await checkout({ userId: buyer.id, productId: boots.id, qty: 1 })



    await dataSource.destroy()
}
