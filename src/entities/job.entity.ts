import { Entity, PrimaryGeneratedColumn, Column, Check } from 'typeorm'

@Entity({ name: 'jobs' })
@Check(`"status" IN ('new', 'done')`)
@Check(`"processed" >= 0`)
export class Job {
  @PrimaryGeneratedColumn('identity', { type: 'bigint' })
  id!: string
  @Column({ type: 'text' })
  payload!: string
  @Column({ type: 'text', default: 'new' })
  status!: string
  @Column({ type: 'text', nullable: true })
  worker!: string | null
  @Column({ type: 'int', default: 0 })
  processed!: number
}
