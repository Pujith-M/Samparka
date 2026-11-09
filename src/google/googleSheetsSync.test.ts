import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDbContactRepository } from '../contacts/contactRepository'
import { SheetsApi } from './googleSheets'
import { GoogleSheetsContactAdapter } from './googleSheetsContacts'
import { CONTACT_HEADERS, contactToRow } from './googleSheetsSchema'
import { syncGoogleChanges } from './googleSheetsSync'

const databaseName = 'samparka-test-google-sync'
const repository = new IndexedDbContactRepository(databaseName)
const originalLocks = navigator.locks

afterEach(async () => {
  await repository.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: originalLocks,
  })
  vi.restoreAllMocks()
})

describe('Google Sheets durable consumer', () => {
  it('reconciles a create after an uncertain append without adding a duplicate', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          _name: string,
          _options: unknown,
          callback: (lock: object) => Promise<unknown>,
        ) => callback({}),
      },
    })
    const contact = await repository.create({
      name: 'Mira Rao',
      phoneNumbers: ['+91 98765 43210'],
    })
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ values: [[...CONTACT_HEADERS]] }))
      .mockRejectedValueOnce(new TypeError('connection dropped after append'))
      .mockResolvedValueOnce(
        Response.json({
          values: [[...CONTACT_HEADERS], contactToRow(contact)],
        }),
      )
      .mockResolvedValueOnce(Response.json({ updatedRange: 'Contacts!A2:J2' }))
    const adapter = new GoogleSheetsContactAdapter(new SheetsApi(fetcher))
    const location = { spreadsheetId: 'test-sheet', worksheet: 'Contacts' }

    const first = await syncGoogleChanges(
      repository,
      adapter,
      location,
      'token',
      1,
    )
    expect(first).toMatchObject({ completed: 0, pending: 1, paused: true })
    expect(await repository.listPendingChanges()).toMatchObject([
      { attempts: 1, lastError: 'transient' },
    ])

    const second = await syncGoogleChanges(
      repository,
      adapter,
      location,
      'token',
      Date.now(),
    )
    expect(second).toMatchObject({ completed: 1, pending: 0, paused: false })
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(fetcher.mock.calls[3][1]?.method).toBe('PUT')
    expect(await repository.listPendingChanges()).toEqual([])
  })
})
