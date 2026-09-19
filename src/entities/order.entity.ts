import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Index, Check, Relation } from 'typeorm'
import type { User } from './user.entity.js'
import type { OrderItem } from './order-item.entity.js'

@Entity({ name: 'orders' })
@Check(`"status" IN ('completed', 'pending', 'cancelled')`)
@Index('idx_orders_user_created', ['user', 'created_at'])
@Index('idx_orders_pending', ['created_at'], { where: `status = 'pending'` })

export class Order {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string
  @ManyToOne('User', 'orders', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user!: User
  @Column({ type: 'text'})
  status!: string
  @Column({ type: 'timestamptz'})
  created_at!: Date
  @OneToMany('OrderItem', 'order', { cascade: true })
  items!: Relation<OrderItem[]>
}