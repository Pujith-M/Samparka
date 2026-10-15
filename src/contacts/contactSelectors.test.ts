import { describe, expect, it } from 'vitest'
import type { Contact } from './contact'
import { getAvailableTags, matchesContact, normalizePhone, normalizeText, selectContacts } from './contactSelectors'

const contact = (overrides: Partial<Contact> = {}): Contact => ({ id: '1', name: 'Maya Rao', phoneNumbers: ['+91 98765 43210'], emails: ['maya@example.com'], description: 'Studio friend', tags: ['Friend'], createdAt: 1, updatedAt: 10, ...overrides })

describe('contact selectors', () => {
  it('normalizes text and phones without mutating stored values', () => {
    expect(normalizeText('  MAYA  ')).toBe('maya')
    expect(normalizePhone('(987) 654-3210')).toBe('9876543210')
  })
  it('matches supported fields and rejects punctuation-only phone searches', () => {
    expect(matchesContact(contact(), '  STUDIO ')).toBe(true)
    expect(matchesContact(contact(), '987654')).toBe(true)
    expect(matchesContact(contact({ name: 'Other', description: '' }), '---')).toBe(false)
  })
  it('composes case-insensitive tag filtering and deterministic sorting', () => {
    const input = [contact({ id: 'b', name: 'Alex', tags: ['WORK'], updatedAt: 2 }), contact({ id: 'a', name: 'Alex', tags: ['work'], updatedAt: 2 }), contact({ id: 'c', name: 'Zoe', tags: ['Friend'], updatedAt: 20 })]
    expect(selectContacts(input, { query: '', selectedTag: 'work', sortOrder: 'name' }).map((item) => item.id)).toEqual(['a', 'b'])
    expect(selectContacts(input, { query: '', selectedTag: null, sortOrder: 'recentlyUpdated' }).map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(input.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })
  it('deduplicates tag choices by case while preserving readable spelling', () => {
    expect(getAvailableTags([contact({ tags: ['Work', 'work', ' FRIEND '] })])).toEqual(['FRIEND', 'Work'])
  })
})
