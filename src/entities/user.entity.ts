import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Relation, Check } from 'typeorm'
import type { Product } from './product.entity.js'
import type { Order } from './order.entity.js'

@Entity({ name: 'users' })
@Check(`"balance" >= 0`)
export class User {
    @PrimaryGeneratedColumn('identity', { type: 'bigint' })
    id!: string
    @Column({ type: 'text', unique: true })
    email!: string
    @Column({ type: 'int', default: 0 })
    balance!: number
    @OneToMany('Product', 'seller')
    products!: Relation<Product[]>
    @OneToMany('Order', 'user')
    orders!: Relation<Order[]>
    @Column({ type: 'timestamptz', default: () => 'now()' })
    created_at!: Date
}