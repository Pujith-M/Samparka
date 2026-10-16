import type { Contact } from '../contacts/contact'

export const SHEET_SCHEMA_VERSION = '1.0'
export const CONTACT_HEADERS = [
  'samparka_contact_id',
  'name',
  'phone_numbers_json',
  'emails_json',
  'description',
  'tags_json',
  'created_at',
  'updated_at',
  'archived_at',
] as const

export type ContactColumn = (typeof CONTACT_HEADERS)[number]
export type SheetRow = string[]
export type ReadonlySheetRow = readonly string[]

export class SheetSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetSchemaError'
  }
}

export type SheetValidation = {
  headers: SheetRow
  rows: SheetRow[]
  idColumn: number
  archiveColumn?: number
}

const isBlank = (row: ReadonlySheetRow) => row.every((cell) => cell.trim() === '')
const parseJsonList = (value: string, field: string): string[] => {
  if (!value.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new SheetSchemaError(`${field} must contain valid JSON.`)
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new SheetSchemaError(`${field} must be a JSON array of strings.`)
  }
  return parsed
}

const cell = (row: ReadonlySheetRow, headers: ReadonlySheetRow, name: ContactColumn) => row[headers.indexOf(name)] ?? ''

export function validateSheetRows(values: readonly ReadonlySheetRow[], options: { requireArchiveColumn?: boolean } = {}): SheetValidation {
  if (values.length === 0) throw new SheetSchemaError('The worksheet is empty; a header row is required.')
  const headers = values[0].map((header) => header.trim())
  if (headers.some((header) => !header)) throw new SheetSchemaError('Header names cannot be blank.')
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index)
  if (duplicates.length) throw new SheetSchemaError(`Duplicate header name: “${duplicates[0]}”.`)
  const missing = CONTACT_HEADERS.filter((header) => header !== 'archived_at' && !headers.includes(header))
  if (missing.length) throw new SheetSchemaError(`Missing required header: “${missing[0]}”.`)
  if (options.requireArchiveColumn && !headers.includes('archived_at')) {
    throw new SheetSchemaError('Archive metadata is missing; ask consent before adding “archived_at”.')
  }
  const rows = values.slice(1).filter((row) => !isBlank(row)).map((row) => [...row])
  const idColumn = headers.indexOf('samparka_contact_id')
  const archiveColumn = headers.indexOf('archived_at')
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    const id = cell(row, headers, 'samparka_contact_id').trim()
    if (!id) throw new SheetSchemaError(`Row ${index + 2} is missing a Samparka contact ID.`)
    if (ids.has(id)) throw new SheetSchemaError(`Duplicate Samparka contact ID “${id}”.`)
    ids.add(id)
    parseContactRow(row, headers, index + 2)
  })
  return { headers, rows, idColumn, archiveColumn: archiveColumn >= 0 ? archiveColumn : undefined }
}

export function parseContactRow(row: SheetRow, headers: SheetRow = [...CONTACT_HEADERS], rowNumber = 2): Contact {
  const id = cell(row, headers, 'samparka_contact_id').trim()
  const name = cell(row, headers, 'name').trim()
  const phoneNumbers = parseJsonList(cell(row, headers, 'phone_numbers_json'), `Row ${rowNumber} phone_numbers_json`)
  const emails = parseJsonList(cell(row, headers, 'emails_json'), `Row ${rowNumber} emails_json`)
  const tags = parseJsonList(cell(row, headers, 'tags_json'), `Row ${rowNumber} tags_json`)
  if (!id || !name || phoneNumbers.length === 0) throw new SheetSchemaError(`Row ${rowNumber} has an empty ID, name, or phone number list.`)
  const createdAt = Number(cell(row, headers, 'created_at'))
  const updatedAt = Number(cell(row, headers, 'updated_at'))
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) throw new SheetSchemaError(`Row ${rowNumber} has invalid timestamps.`)
  return { id, name, phoneNumbers, emails, description: cell(row, headers, 'description') || undefined, tags, createdAt, updatedAt }
}

export function contactToRow(contact: Contact, headers: readonly string[] = CONTACT_HEADERS): SheetRow {
  const archive = headers.includes('archived_at') ? '' : undefined
  const values: Record<string, string> = {
    samparka_contact_id: contact.id,
    name: contact.name,
    phone_numbers_json: JSON.stringify(contact.phoneNumbers),
    emails_json: JSON.stringify(contact.emails),
    description: contact.description ?? '',
    tags_json: JSON.stringify(contact.tags),
    created_at: String(contact.createdAt),
    updated_at: String(contact.updatedAt),
    archived_at: archive ?? '',
  }
  return headers.map((header) => values[header] ?? '')
}

export function findContactRow(validation: SheetValidation, id: string): number {
  const rowIndex = validation.rows.findIndex((row) => row[validation.idColumn]?.trim() === id)
  return rowIndex < 0 ? -1 : rowIndex + 2
}

export function archiveCell(validation: SheetValidation, id: string, archivedAt: number | null): { rowNumber: number; column: number; value: string } {
  if (validation.archiveColumn === undefined) throw new SheetSchemaError('Archive metadata is missing; ask consent before adding “archived_at”.')
  const rowNumber = findContactRow(validation, id)
  if (rowNumber < 0) throw new SheetSchemaError(`Contact “${id}” was not found.`)
  return { rowNumber, column: validation.archiveColumn, value: archivedAt === null ? '' : String(archivedAt) }
}
