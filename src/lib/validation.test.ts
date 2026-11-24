import { describe, expect, it } from 'vitest'
import { leadSignupSchema, normalizeEmail } from './validation'

describe('normalização de e-mail', () => {
  it('remove espaços e converte o endereço para minúsculas', () => {
    expect(normalizeEmail('  Pessoa@Exemplo.COM  ')).toBe('pessoa@exemplo.com')
  })

  it('aceita uma inscrição com consentimento explícito', () => {
    expect(leadSignupSchema.safeParse({ email: 'pessoa@exemplo.com', consent: true }).success).toBe(true)
  })

  it('rejeita e-mail inválido e consentimento ausente', () => {
    expect(leadSignupSchema.safeParse({ email: 'inválido', consent: true }).success).toBe(false)
    expect(leadSignupSchema.safeParse({ email: 'pessoa@exemplo.com', consent: false }).success).toBe(false)
  })
})
