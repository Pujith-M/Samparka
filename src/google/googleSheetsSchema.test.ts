import { describe, expect, it } from 'vitest'
import type { Contact } from '../contacts/contact'
import { CONTACT_HEADERS, SheetSchemaError, contactToRow, parseContactRow, validateSheetRows } from './googleSheetsSchema'

const contact: Contact = {
  id: 'stable-1', name: 'Zoë, “Z”', phoneNumbers: ['+1,555', '办公室'], emails: ['z@example.com'],
  description: 'Uses commas, quotes, and Unicode', tags: ['Friend', 'Work'], createdAt: 10, updatedAt: 20,
}

const row = contactToRow(contact)

describe('Google Sheets contact schema', () => {
  it('round trips arrays, optional text, punctuation, and Unicode', () => {
    expect(parseContactRow(row)).toEqual(contact)
  })

  it('ignores blank rows and preserves unknown columns during conversion', () => {
    const headers = [...CONTACT_HEADERS, 'unrelated']
    const values = [headers, [...row, 'keep me'], Array(headers.length).fill('')]
    const result = validateSheetRows(values)
    expect(result.rows).toHaveLength(1)
    expect(contactToRow(contact, headers).at(-1)).toBe('')
  })

  it.each([
    ['missing header', CONTACT_HEADERS.slice(1)],
    ['duplicate header', [...CONTACT_HEADERS.slice(0, -1), 'name', 'archived_at']],
  ])('blocks %s', (_, headers) => {
    expect(() => validateSheetRows([headers])).toThrow(SheetSchemaError)
  })

  it('blocks duplicate and missing IDs and malformed JSON', () => {
    expect(() => validateSheetRows([CONTACT_HEADERS, row, row])).toThrow(/Duplicate Samparka contact ID/)
    const missing = [...row]; missing[0] = ''
    expect(() => validateSheetRows([CONTACT_HEADERS, missing])).toThrow(/missing.*ID/i)
    const malformed = [...row]; malformed[2] = 'not json'
    expect(() => validateSheetRows([CONTACT_HEADERS, malformed])).toThrow(/valid JSON/)
  })

  it('requires archive metadata before archive operations', () => {
    const headers = CONTACT_HEADERS.filter((header) => header !== 'archivedAt')
    const values = contactToRow(contact, headers)
    expect(() => validateSheetRows([headers, values], { requireArchiveColumn: true })).toThrow(/Archive metadata/)
  })
})
