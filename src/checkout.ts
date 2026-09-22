import dataSource from './data-source.js'
import { User } from './entities/user.entity.js'
import { Order } from './entities/order.entity.js'
import { OrderItem } from './entities/order-item.entity.js'
import { Product } from './entities/product.entity.js'
import { withRetry } from './lib/retry.js'


export async function checkout({ userId, productId, qty, delayMs = 0 }: { userId: string; productId: string; qty: number, delayMs?: number }) {
    const qr = dataSource.createQueryRunner()
    await qr.connect()
    await qr.startTransaction()

    try { 
        const users = qr.manager.getRepository(User);
        const orders = qr.manager.getRepository(Order);
        const orderItems = qr.manager.getRepository(OrderItem);
        const products = qr.manager.getRepository(Product);
        
        const updated = await qr.manager.query(
            `UPDATE products SET stock = stock - $1
                WHERE id = $2 AND stock >= $1
                RETURNING *`,
            [qty, productId],
        )
        
        const [rows, count] = updated
        if (!count) {
            throw new Error('out of stock')
        }
        const product = rows[0]
    
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

    await withRetry(() => checkout({ userId: buyer.id, productId: boots.id, qty: 1 }));
    await dataSource.destroy()
}