export interface Contact {
  id: string
  name: string
  phoneNumbers: string[]
  emails: string[]
  description?: string
  tags: string[]
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type ContactInput = Pick<Contact, 'name' | 'phoneNumbers'> &
  Partial<Pick<Contact, 'emails' | 'description' | 'tags'>>

export type ContactUpdate = Partial<ContactInput>
export type NormalizedContact = Pick<Contact, 'name' | 'phoneNumbers' | 'emails' | 'tags'> &
  Pick<Contact, 'description'>

export class ContactValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContactValidationError'
  }
}

const cleanStringList = (values: string[] | undefined, field: string): string[] => {
  if (values === undefined) return []
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new ContactValidationError(`${field} must be a list of strings.`)
  }
  return values.map((value) => value.trim()).filter(Boolean)
}

export function normalizeTags(values: string[] | undefined): string[] {
  const tags = cleanStringList(values, 'Tags')
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeContact(input: ContactInput): NormalizedContact {
  if (!input || typeof input !== 'object') {
    throw new ContactValidationError('Contact details are required.')
  }

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new ContactValidationError('Name is required.')

  const phoneNumbers = cleanStringList(input.phoneNumbers, 'Phone numbers')
  if (phoneNumbers.length === 0) {
    throw new ContactValidationError('At least one non-empty phone number is required.')
  }

  const emails = cleanStringList(input.emails, 'Emails')
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ContactValidationError(`“${email}” is not a valid email address.`)
    }
  }

  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new ContactValidationError('Description must be text.')
  }
  const description = input.description?.trim() || undefined

  return { name, phoneNumbers, emails, description, tags: normalizeTags(input.tags) }
}
