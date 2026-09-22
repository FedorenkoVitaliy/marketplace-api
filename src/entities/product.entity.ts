import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, Check, Relation } from 'typeorm'
import type { User } from './user.entity.js'

@Entity({ name: 'products' })
@Check(`"price" > 0`)
export class Product {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string
  @ManyToOne('User', 'products', { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'seller_id' })
  seller!: Relation<User>
  @Column({ type: 'text', unique: false })
  name!: string
  @Column({ type: 'text', unique: false })
  description!: string
  @Column({ type: 'int', unique: false })
  price!: number
  @Column({ type: 'timestamptz', default: () => 'now()' })
  created_at!: Date
  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: `
      setweight(to_tsvector('simple', name), 'A') ||
      setweight(to_tsvector('simple', description), 'B')
    `,
  })
  @Index()
  search_vector!: string
}