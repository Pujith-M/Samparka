import type { Contact } from '../contacts/contact'
import { GoogleIntegrationError, SheetsApi } from './googleSheets'
import { contactToRow, findContactRow, parseContactRow, validateSheetRows, type SheetValidation } from './googleSheetsSchema'

export type SheetLocation = { spreadsheetId: string; worksheet: string }
export type ConsentHandler = (missing: readonly string[]) => Promise<boolean>

export class GoogleSheetsContactAdapter {
  constructor(private readonly api: SheetsApi, private readonly consent: ConsentHandler = async () => false) {}

  private async validated(location: SheetLocation, token: string, requireArchive = false): Promise<{ validation: SheetValidation; values: string[][] }> {
    const values = await this.api.readValues(location.spreadsheetId, `${location.worksheet}!A:ZZ`, token)
    const validation = validateSheetRows(values, { requireArchiveColumn: requireArchive })
    return { validation, values }
  }

  private async ensureColumns(location: SheetLocation, token: string, values: string[][], names: string[]) {
    const headers = values[0] ?? []
    const missing = names.filter((name) => !headers.includes(name))
    if (!missing.length) return values
    if (!(await this.consent(missing))) throw new GoogleIntegrationError(`Consent is required before adding: ${missing.join(', ')}.`, 'api')
    await this.api.updateValues(location.spreadsheetId, `${location.worksheet}!A1`, [[...headers, ...missing]], token)
    return [[...headers, ...missing], ...values.slice(1).map((row) => [...row, ...missing.map(() => '')])]
  }

  async list(location: SheetLocation, token: string, includeArchived = false): Promise<Contact[]> {
    const { validation } = await this.validated(location, token)
    return validation.rows.map((row) => parseContactRow(row, validation.headers)).filter((contact) => includeArchived || contact.archivedAt === undefined)
  }

  async create(location: SheetLocation, contact: Contact, token: string): Promise<void> {
    const { validation } = await this.validated(location, token)
    await this.api.appendRow(location.spreadsheetId, location.worksheet, contact, token, validation.headers)
  }

  async update(location: SheetLocation, contact: Contact, token: string): Promise<void> {
    const { validation } = await this.validated(location, token)
    const rowNumber = findContactRow(validation, contact.id)
    if (rowNumber < 0) throw new GoogleIntegrationError(`Contact “${contact.id}” was not found.`, 'api')
    const existing = validation.rows[rowNumber - 2]
    await this.api.updateValues(location.spreadsheetId, `${location.worksheet}!A${rowNumber}`, [contactToRow(contact, validation.headers, existing)], token)
  }

  async archive(location: SheetLocation, id: string, token: string): Promise<void> { await this.setArchive(location, id, Date.now(), token) }
  async restore(location: SheetLocation, id: string, token: string): Promise<void> { await this.setArchive(location, id, null, token) }

  private async setArchive(location: SheetLocation, id: string, archivedAt: number | null, token: string) {
    let { validation, values } = await this.validated(location, token)
    if (validation.archiveColumn === undefined) {
      values = await this.ensureColumns(location, token, values, ['archivedAt'])
      validation = validateSheetRows(values)
    }
    const rowNumber = findContactRow(validation, id)
    if (rowNumber < 0) throw new GoogleIntegrationError(`Contact “${id}” was not found.`, 'api')
    const column = validation.archiveColumn as number
    await this.api.updateValues(location.spreadsheetId, `${location.worksheet}!${columnToLetter(column + 1)}${rowNumber}`, [[archivedAt === null ? '' : String(archivedAt)]], token)
  }
}

function columnToLetter(column: number): string {
  let result = ''
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return result
}
