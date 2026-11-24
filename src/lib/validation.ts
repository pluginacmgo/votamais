import { z } from 'zod'

export const emailSchema = z.string().trim().email('Informe um e-mail válido.').max(254, 'O e-mail é muito longo.')
export const leadSignupSchema = z.object({
  email: emailSchema,
  first_name: z.string().trim().max(80).nullable().optional(),
  consent: z.literal(true, { error: 'O consentimento comercial é obrigatório.' }),
})

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
