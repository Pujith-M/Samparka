import type { Contact } from './contact'

export type ContactSortOrder = 'name' | 'recentlyUpdated'

export interface ContactSelectorCriteria {
  query: string
  selectedTag: string | null
  sortOrder: ContactSortOrder
}

export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

export function getAvailableTags(contacts: readonly Contact[]): string[] {
  const tags = new Map<string, string>()
  for (const contact of contacts) {
    for (const tag of contact.tags) {
      const key = normalizeText(tag)
      if (key && !tags.has(key)) tags.set(key, tag.trim())
    }
  }
  return [...tags.values()].sort((a, b) => normalizeText(a).localeCompare(normalizeText(b)))
}

export function matchesContact(contact: Contact, query: string): boolean {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true
  const textMatch = [contact.name, ...contact.emails, contact.description ?? '', ...contact.tags]
    .some((value) => normalizeText(value).includes(normalizedQuery))
  const phoneQuery = normalizePhone(query)
  const phoneMatch = phoneQuery.length > 0 && contact.phoneNumbers.some((phone) => normalizePhone(phone).includes(phoneQuery))
  return textMatch || phoneMatch
}

const compareId = (a: Contact, b: Contact) => a.id.localeCompare(b.id)
const compareName = (a: Contact, b: Contact) => normalizeText(a.name).localeCompare(normalizeText(b.name))

export function selectContacts(contacts: readonly Contact[], criteria: ContactSelectorCriteria): Contact[] {
  const selectedTag = criteria.selectedTag ? normalizeText(criteria.selectedTag) : ''
  const filtered = contacts.filter((contact) => matchesContact(contact, criteria.query) && (!selectedTag || contact.tags.some((tag) => normalizeText(tag) === selectedTag)))
  return [...filtered].sort((a, b) => {
    if (criteria.sortOrder === 'recentlyUpdated') {
      return b.updatedAt - a.updatedAt || compareName(a, b) || compareId(a, b)
    }
    return compareName(a, b) || compareId(a, b)
  })
}

export function hasActiveContactFilters(criteria: ContactSelectorCriteria): boolean {
  return Boolean(normalizeText(criteria.query) || normalizeText(criteria.selectedTag ?? ''))
}

export function getContactSortLabel(sortOrder: ContactSortOrder): string {
  return sortOrder === 'name' ? 'Name (A–Z)' : 'Recently updated'
}

export function benchmarkContactSelector(contacts: readonly Contact[], criteria: ContactSelectorCriteria, iterations = 1): number {
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) selectContacts(contacts, criteria)
  return performance.now() - start
}
