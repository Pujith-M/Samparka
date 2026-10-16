import type { Contact } from '../contacts/contact'
import { GoogleIntegrationError, SheetsApi } from './googleSheets'
import {
  contactToRow,
  findContactRow,
  parseContactRow,
  validateSheetRows,
  type SheetValidation,
} from './googleSheetsSchema'

export type SheetLocation = { spreadsheetId: string; worksheet: string }

export class GoogleSheetsContactAdapter {
  constructor(private readonly api: SheetsApi) {}

  private async validated(
    location: SheetLocation,
    token: string,
    requireArchive = false,
  ): Promise<{ validation: SheetValidation; values: string[][] }> {
    const values = await this.api.readValues(
      location.spreadsheetId,
      `${location.worksheet}!A:ZZ`,
      token,
    )
    const validation = validateSheetRows(values, {
      requireArchiveColumn: requireArchive,
    })
    return { validation, values }
  }

  async list(
    location: SheetLocation,
    token: string,
    includeArchived = false,
  ): Promise<Contact[]> {
    const { validation } = await this.validated(location, token)
    return validation.rows
      .map((row) => parseContactRow(row, validation.headers))
      .filter((contact) => includeArchived || contact.archivedAt === undefined)
  }

  async create(
    location: SheetLocation,
    contact: Contact,
    token: string,
  ): Promise<void> {
    const values = await this.api.readValues(
      location.spreadsheetId,
      `${location.worksheet}!A:ZZ`,
      token,
    )
    const validation = validateSheetRows(values).headers
    await this.api.appendRow(
      location.spreadsheetId,
      location.worksheet,
      contact,
      token,
      validation,
    )
  }

  async update(
    location: SheetLocation,
    contact: Contact,
    token: string,
  ): Promise<void> {
    const { validation } = await this.validated(location, token)
    const rowNumber = findContactRow(validation, contact.id)
    if (rowNumber < 0)
      throw new GoogleIntegrationError(
        `Contact “${contact.id}” was not found.`,
        'api',
      )
    const existing = validation.rows[rowNumber - 2]
    await this.api.updateValues(
      location.spreadsheetId,
      `${location.worksheet}!A${rowNumber}`,
      [contactToRow(contact, validation.headers, existing)],
      token,
    )
  }

  async archive(
    location: SheetLocation,
    id: string,
    token: string,
  ): Promise<void> {
    await this.setArchive(location, id, Date.now(), token)
  }
  async restore(
    location: SheetLocation,
    id: string,
    token: string,
  ): Promise<void> {
    await this.setArchive(location, id, null, token)
  }

  private async setArchive(
    location: SheetLocation,
    id: string,
    archivedAt: number | null,
    token: string,
  ) {
    const { validation } = await this.validated(location, token, true)
    const rowNumber = findContactRow(validation, id)
    if (rowNumber < 0)
      throw new GoogleIntegrationError(`Contact “${id}” was not found.`, 'api')
    const column = validation.archiveColumn as number
    await this.api.updateValues(
      location.spreadsheetId,
      `${location.worksheet}!${columnToLetter(column + 1)}${rowNumber}`,
      [[archivedAt === null ? '' : String(archivedAt)]],
      token,
    )
  }
}

function columnToLetter(column: number): string {
  let result = ''
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return result
}
