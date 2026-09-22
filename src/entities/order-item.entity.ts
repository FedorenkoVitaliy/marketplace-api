import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Check, Relation } from 'typeorm'
import type { Order } from './order.entity.js'
import type { Product } from './product.entity.js'

@Entity({ name: 'order_items' })
@Check(`"qty" > 0`)
@Check(`"unit_price" > 0`)

export class OrderItem {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string
  @ManyToOne('Order', 'items', { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'order_id' })
  order!: Relation<Order>
  @ManyToOne('Product', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'product_id' })
  product!: Relation<Product>
  @Column({ type: 'int'})
  qty!: number
  @Column({ type: 'int'})
  unit_price!: number
}