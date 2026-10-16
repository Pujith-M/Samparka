import type { Contact } from '../contacts/contact'

export const SHEET_SCHEMA_VERSION = '1.0'
export const CONTACT_HEADERS = [
  'id', 'name', 'phoneNumbers', 'emails', 'description', 'tags',
  'createdAt', 'updatedAt', 'archivedAt', 'schemaVersion',
] as const
export const MANAGED_HEADERS = [...CONTACT_HEADERS] as readonly string[]

export type SheetRow = string[]
export type ReadonlySheetRow = readonly string[]
export type SheetValidation = {
  headers: SheetRow
  rows: SheetRow[]
  idColumn: number
  archiveColumn?: number
  schemaVersionColumn: number
}

export class SheetSchemaError extends Error {
  constructor(message: string) { super(message); this.name = 'SheetSchemaError' }
}

const isBlank = (row: ReadonlySheetRow) => row.every((cell) => cell.trim() === '')
const indexOf = (headers: ReadonlySheetRow, name: string) => headers.indexOf(name)
const value = (row: ReadonlySheetRow, headers: ReadonlySheetRow, name: string) => row[indexOf(headers, name)] ?? ''

function parseList(raw: string, field: string, rowNumber: number): string[] {
  if (!raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error()
    return parsed
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'valid JSON' : 'a JSON array of strings'
    throw new SheetSchemaError(`Row ${rowNumber} ${field} must contain ${reason}.`)
  }
}

export function validateSheetRows(values: readonly ReadonlySheetRow[], options: { requireArchiveColumn?: boolean } = {}): SheetValidation {
  if (!values.length) throw new SheetSchemaError('The worksheet is empty; a header row is required.')
  const headers = [...values[0]].map((header) => header.trim())
  if (headers.some((header) => !header)) throw new SheetSchemaError('Header names cannot be blank.')
  const duplicate = headers.find((header, index) => headers.indexOf(header) !== index)
  if (duplicate) throw new SheetSchemaError(`Duplicate header name: “${duplicate}”.`)
  const missing = MANAGED_HEADERS.filter((header) => header !== 'archivedAt' && !headers.includes(header))
  if (missing.length) throw new SheetSchemaError(`Missing required header: “${missing[0]}”.`)
  const archiveColumn = indexOf(headers, 'archivedAt')
  if (options.requireArchiveColumn && archiveColumn < 0) throw new SheetSchemaError('Archive metadata is missing; ask consent before adding “archivedAt”.')
  const rows = values.slice(1).filter((row) => !isBlank(row)).map((row) => [...row])
  const ids = new Set<string>()
  rows.forEach((row, offset) => {
    const rowNumber = offset + 2
    const id = value(row, headers, 'id').trim()
    if (!id) throw new SheetSchemaError(`Row ${rowNumber} is missing a Samparka contact ID.`)
    if (ids.has(id)) throw new SheetSchemaError(`Duplicate Samparka contact ID “${id}”.`)
    ids.add(id)
    parseContactRow(row, headers, rowNumber)
  })
  return { headers, rows, idColumn: indexOf(headers, 'id'), archiveColumn: archiveColumn >= 0 ? archiveColumn : undefined, schemaVersionColumn: indexOf(headers, 'schemaVersion') }
}

export function parseContactRow(row: SheetRow, headers: SheetRow = [...CONTACT_HEADERS], rowNumber = 2): Contact {
  const id = value(row, headers, 'id').trim()
  const name = value(row, headers, 'name').trim()
  const phoneNumbers = parseList(value(row, headers, 'phoneNumbers'), 'phoneNumbers', rowNumber)
  const emails = parseList(value(row, headers, 'emails'), 'emails', rowNumber)
  const tags = parseList(value(row, headers, 'tags'), 'tags', rowNumber)
  const createdAt = Number(value(row, headers, 'createdAt'))
  const updatedAt = Number(value(row, headers, 'updatedAt'))
  const archivedRaw = value(row, headers, 'archivedAt').trim()
  const schemaVersion = value(row, headers, 'schemaVersion').trim()
  if (!id || !name || !phoneNumbers.length) throw new SheetSchemaError(`Row ${rowNumber} has an empty ID, name, or phone number list.`)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) throw new SheetSchemaError(`Row ${rowNumber} has invalid timestamps.`)
  if (schemaVersion !== SHEET_SCHEMA_VERSION) throw new SheetSchemaError(`Row ${rowNumber} has unsupported schemaVersion “${schemaVersion}”.`)
  if (archivedRaw && !Number.isFinite(Number(archivedRaw))) throw new SheetSchemaError(`Row ${rowNumber} has an invalid archivedAt timestamp.`)
  return { id, name, phoneNumbers, emails, description: value(row, headers, 'description') || undefined, tags, createdAt, updatedAt, ...(archivedRaw ? { archivedAt: Number(archivedRaw) } : {}) }
}

export function contactToRow(contact: Contact, headers: readonly string[] = CONTACT_HEADERS, existingRow: ReadonlySheetRow = []): SheetRow {
  const values: Record<string, string> = {
    id: contact.id, name: contact.name, phoneNumbers: JSON.stringify(contact.phoneNumbers), emails: JSON.stringify(contact.emails),
    description: contact.description ?? '', tags: JSON.stringify(contact.tags), createdAt: String(contact.createdAt), updatedAt: String(contact.updatedAt),
    archivedAt: contact.archivedAt === undefined ? '' : String(contact.archivedAt), schemaVersion: SHEET_SCHEMA_VERSION,
  }
  return headers.map((header, index) => header in values ? values[header] : existingRow[index] ?? '')
}

export function findContactRow(validation: SheetValidation, id: string): number {
  const index = validation.rows.findIndex((row) => row[validation.idColumn]?.trim() === id)
  return index < 0 ? -1 : index + 2
}

export function archiveCell(validation: SheetValidation, id: string, archivedAt: number | null) {
  if (validation.archiveColumn === undefined) throw new SheetSchemaError('Archive metadata is missing; ask consent before adding “archivedAt”.')
  const rowNumber = findContactRow(validation, id)
  if (rowNumber < 0) throw new SheetSchemaError(`Contact “${id}” was not found.`)
  return { rowNumber, column: validation.archiveColumn, value: archivedAt === null ? '' : String(archivedAt) }
}
