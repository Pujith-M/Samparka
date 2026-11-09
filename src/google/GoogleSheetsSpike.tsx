import { useCallback, useEffect, useState } from 'react'
import {
  GoogleIntegrationError,
  SheetsApi,
  pickSpreadsheet,
  requestGoogleAccessToken,
} from './googleSheets'
import type { SelectedSpreadsheet, SheetPreview } from './googleSheets'
import { GoogleSheetsContactAdapter } from './googleSheetsContacts'
import type { SheetLocation } from './googleSheetsContacts'
import { syncGoogleChanges } from './googleSheetsSync'
import type { Contact } from '../contacts/contact'
import type { ContactRepository } from '../contacts/contactRepository'

const config = {
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? '',
  appId: import.meta.env.VITE_GOOGLE_APP_ID ?? '',
}
const sheets = new SheetsApi()
const contactAdapter = new GoogleSheetsContactAdapter(sheets)
const savedSheetKey = 'samparka.google.sheet.v1'
type SavedSpreadsheet = SelectedSpreadsheet & { worksheet: string }
type QueueSummary = { pending: number; blocked: number }

function isTokenExpired(token?: { expiresAt: number }): boolean {
  return !token || token.expiresAt <= Date.now()
}

export function GoogleSheetsSpike({
  onClose,
  repository,
}: {
  onClose: () => void
  repository: ContactRepository
}) {
  const [token, setToken] = useState<{ value: string; expiresAt: number }>()
  const [connected, setConnected] = useState(false)
  const [spreadsheet, setSpreadsheet] = useState<SavedSpreadsheet | undefined>(
    () => {
      try {
        const value = localStorage.getItem(savedSheetKey)
        return value ? (JSON.parse(value) as SavedSpreadsheet) : undefined
      } catch {
        return undefined
      }
    },
  )
  const [preview, setPreview] = useState<SheetPreview>()
  const [worksheetChoice, setWorksheetChoice] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<QueueSummary>({ pending: 0, blocked: 0 })
  const [archivedContacts, setArchivedContacts] = useState<Contact[] | null>(
    null,
  )
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] =
    useState('Samparka Contacts')

  const refreshQueue = useCallback(async () => {
    const events = await repository.listChanges()
    setQueue({
      pending: events.filter((event) => event.status === 'pending').length,
      blocked: events.filter((event) => event.status === 'blocked').length,
    })
  }, [repository])

  useEffect(() => {
    let cancelled = false
    void repository
      .listChanges()
      .then((events) => {
        if (!cancelled) {
          setQueue({
            pending: events.filter((event) => event.status === 'pending')
              .length,
            blocked: events.filter((event) => event.status === 'blocked')
              .length,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setMessage('The local backup queue could not be read.')
      })
    return () => {
      cancelled = true
    }
  }, [repository, refreshQueue])

  const trace = (event: string, detail?: string) => {
    const line = `${new Date().toISOString()} ${event}${detail ? ` — ${detail}` : ''}`
    setDiagnostics((current) => [...current.slice(-19), line])
    console.info('[Samparka Google trace]', line)
  }

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    trace(`${label}.started`)
    try {
      await operation()
      trace(`${label}.completed`)
    } catch (error) {
      if (error instanceof GoogleIntegrationError && error.code === 'expired')
        setToken(undefined)
      if (
        error instanceof GoogleIntegrationError &&
        (error.code === 'expired' || error.code === 'denied')
      )
        setConnected(false)
      trace(
        `${label}.failed`,
        error instanceof GoogleIntegrationError
          ? `${error.code}${error.status ? ` HTTP ${error.status}` : ''} — ${error.message
              .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
              .replace(/https?:\/\/[^\s]+/gi, '[URL redacted]')
              .slice(0, 240)}`
          : 'unexpected error',
      )
      setMessage(
        error instanceof Error
          ? error.message
          : 'Google Sheets request failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!connected || !token || !spreadsheet) return
    const resumeSync = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      if (token.expiresAt <= Date.now()) {
        setConnected(false)
        setToken(undefined)
        setMessage(
          'Google access expired. Reconnect to continue backing up changes.',
        )
        return
      }
      void (async () => {
        const location = {
          spreadsheetId: spreadsheet.id,
          worksheet: spreadsheet.worksheet,
        }
        const result = await syncGoogleChanges(
          repository,
          contactAdapter,
          location,
          token.value,
        )
        await refreshQueue()
        if (result.busy)
          setMessage('Another Samparka tab is already backing up changes.')
        else if (result.blocked)
          setMessage(`${result.blocked} backup change(s) need review.`)
        else if (result.paused)
          setMessage(
            'Backup is paused until Google access or network connectivity returns.',
          )
      })().catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : 'Could not resume backup.',
        )
      })
    }
    resumeSync()
    window.addEventListener('online', resumeSync)
    document.addEventListener('visibilitychange', resumeSync)
    return () => {
      window.removeEventListener('online', resumeSync)
      document.removeEventListener('visibilitychange', resumeSync)
    }
  }, [connected, token, spreadsheet, repository, refreshQueue])
  const connect = () =>
    void run('chooseExistingSpreadsheet', async () => {
      trace('authorization.requested')
      const auth = await requestGoogleAccessToken(config)
      trace('authorization.granted')
      setToken({ value: auth.accessToken, expiresAt: auth.expiresAt })
      trace('picker.opened')
      const selected = await pickSpreadsheet(config, auth.accessToken)
      trace('picker.spreadsheetSelected')
      trace('preview.requested')
      const sheetPreview = await sheets.preview(selected.id, auth.accessToken)
      const worksheet = sheetPreview.worksheet ?? 'Sheet1'
      saveSpreadsheet(selected, worksheet)
      setWorksheetChoice(worksheet)
      setPreview(sheetPreview)
      setConnected(true)
      trace('preview.completed')
      setMessage(
        `Connected to ${selected.name}. The access token stays in memory and expires automatically.`,
      )
    })
  const createSpreadsheet = () =>
    void run('createSpreadsheet', async () => {
      if (!token) trace('authorization.requested')
      const auth =
        token && !isTokenExpired(token)
          ? token
          : await requestGoogleAccessToken(config)
      const accessToken = 'value' in auth ? auth.value : auth.accessToken
      const expiresAt = 'value' in auth ? auth.expiresAt : auth.expiresAt
      if (!token) trace('authorization.granted')
      setToken({ value: accessToken, expiresAt })
      trace('sheets.create.requested')
      const selected = await sheets.createSpreadsheet(
        newSpreadsheetTitle.trim(),
        accessToken,
      )
      trace('sheets.create.responseReceived')
      trace('preview.requested')
      const sheetPreview = await sheets.preview(selected.id, accessToken)
      const worksheet = sheetPreview.worksheet ?? 'Sheet1'
      saveSpreadsheet(selected, worksheet)
      setWorksheetChoice(worksheet)
      setPreview(sheetPreview)
      setConnected(true)
      trace('preview.completed')
      setMessage(`Created and selected ${selected.name} in your Google Drive.`)
    })

  const saveSpreadsheet = (
    selected: SelectedSpreadsheet,
    worksheet: string,
  ) => {
    const saved = { ...selected, worksheet }
    setSpreadsheet(saved)
    localStorage.setItem(savedSheetKey, JSON.stringify(saved))
  }

  const getAuthorizedDestination = async () => {
    let activeToken = token
    if (isTokenExpired(activeToken)) {
      const auth = await requestGoogleAccessToken(config)
      activeToken = { value: auth.accessToken, expiresAt: auth.expiresAt }
      setToken(activeToken)
    }
    if (!activeToken) {
      throw new GoogleIntegrationError(
        'Google authorization is required to continue.',
        'denied',
      )
    }
    let destination = spreadsheet
    if (!destination) {
      const picked = await pickSpreadsheet(config, activeToken.value)
      const sheetPreview = await sheets.preview(picked.id, activeToken.value)
      const worksheet = sheetPreview.worksheet ?? 'Sheet1'
      destination = {
        ...picked,
        worksheet,
      }
      saveSpreadsheet(picked, worksheet)
      setPreview(sheetPreview)
      setWorksheetChoice(worksheet)
    }
    setConnected(true)
    return { activeToken, destination }
  }

  const loadWorksheetOptions = () =>
    void run('loadWorksheetOptions', async () => {
      const { activeToken, destination } = await getAuthorizedDestination()
      const sheetPreview = await sheets.preview(
        destination.id,
        activeToken.value,
        destination.worksheet,
      )
      setPreview(sheetPreview)
      setWorksheetChoice(sheetPreview.worksheet ?? destination.worksheet)
    })

  const selectWorksheet = () =>
    void run('selectWorksheet', async () => {
      if (!worksheetChoice) return
      const { activeToken, destination } = await getAuthorizedDestination()
      const sheetPreview = await sheets.preview(
        destination.id,
        activeToken.value,
        worksheetChoice,
      )
      const worksheet = sheetPreview.worksheet ?? destination.worksheet
      saveSpreadsheet(destination, worksheet)
      setWorksheetChoice(worksheet)
      setPreview(sheetPreview)
      setMessage(`Using worksheet ${worksheet}.`)
    })

  const importFromDestination = async (
    location: SheetLocation,
    accessToken: string,
  ) => {
    const remoteContacts = await contactAdapter.list(location, accessToken)
    const result = await repository.importRemoteContacts(remoteContacts)
    await refreshQueue()
    setMessage(
      `Imported ${result.imported} contact(s); preserved ${result.preservedLocal} existing local contact(s); skipped ${result.skippedPendingArchive} pending archive(s).`,
    )
  }

  const backupToDestination = async (
    location: SheetLocation,
    accessToken: string,
  ) => {
    const result = await syncGoogleChanges(
      repository,
      contactAdapter,
      location,
      accessToken,
    )
    await refreshQueue()
    setMessage(
      result.busy
        ? 'Another Samparka tab is already backing up changes. Try again in a moment.'
        : result.blocked
          ? `${result.completed} change(s) backed up; ${result.blocked} need review.`
          : result.paused
            ? `${result.completed} change(s) backed up. Remaining changes are waiting to retry or reconnect.`
            : `${result.completed} change(s) backed up; ${result.pending} remain pending.`,
    )
  }

  const backUpChanges = () =>
    void run('backupChanges', async () => {
      const { activeToken, destination } = await getAuthorizedDestination()
      await backupToDestination(
        {
          spreadsheetId: destination.id,
          worksheet: destination.worksheet,
        },
        activeToken.value,
      )
    })

  const importContacts = () =>
    void run('importContacts', async () => {
      const { activeToken, destination } = await getAuthorizedDestination()
      const location = {
        spreadsheetId: destination.id,
        worksheet: destination.worksheet,
      }
      await importFromDestination(location, activeToken.value)
    })

  const loadArchivedFromDestination = async (
    location: SheetLocation,
    accessToken: string,
  ) => {
    const contacts = await contactAdapter.list(location, accessToken, true)
    setArchivedContacts(
      contacts.filter((contact) => contact.archivedAt !== undefined),
    )
  }

  const loadArchivedContacts = () =>
    void run('loadArchivedContacts', async () => {
      const { activeToken, destination } = await getAuthorizedDestination()
      const location = {
        spreadsheetId: destination.id,
        worksheet: destination.worksheet,
      }
      await loadArchivedFromDestination(location, activeToken.value)
    })

  const restoreArchivedContact = (contact: Contact) =>
    void run('restoreArchivedContact', async () => {
      const { activeToken, destination } = await getAuthorizedDestination()
      await contactAdapter.restore(
        {
          spreadsheetId: destination.id,
          worksheet: destination.worksheet,
        },
        contact.id,
        activeToken.value,
      )
      const activeContact = { ...contact }
      delete activeContact.archivedAt
      const result = await repository.importRemoteContacts([activeContact])
      setArchivedContacts(
        (current) => current?.filter((item) => item.id !== contact.id) ?? [],
      )
      await refreshQueue()
      setMessage(
        result.imported
          ? `${contact.name} was restored to the active list.`
          : `${contact.name} was restored in the sheet. Its existing local version was preserved and queued if needed.`,
      )
    })

  const retryBlocked = () =>
    void run('retryBlockedChanges', async () => {
      const count = await repository.retryBlockedChanges()
      await refreshQueue()
      setMessage(
        count
          ? `${count} change(s) are ready to retry. Review the selected sheet, then choose Back up pending changes.`
          : 'There are no blocked changes to retry.',
      )
    })

  return (
    <section className="form-view" aria-labelledby="google-title">
      <button className="back-button" onClick={onClose}>
        ← <span>Contacts</span>
      </button>
      <p className="eyebrow">Feasibility spike</p>
      <h1 id="google-title">Google Sheets</h1>
      <p className="spike-copy">
        Choose an existing worksheet that already uses the Samparka contact
        schema or create a new Samparka worksheet. Existing worksheets are not
        changed automatically; missing required columns are reported for review.
      </p>
      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {!spreadsheet ? (
        <div className="google-choice-actions">
          <button
            className="button button-primary"
            onClick={connect}
            disabled={busy}
          >
            {busy ? 'Waiting for Google…' : 'Choose an existing Samparka sheet'}
          </button>
          <label className="select-field" htmlFor="new-spreadsheet-title">
            New spreadsheet name
            <input
              id="new-spreadsheet-title"
              value={newSpreadsheetTitle}
              onChange={(event) => setNewSpreadsheetTitle(event.target.value)}
            />
          </label>
          <button
            className="button button-secondary"
            onClick={createSpreadsheet}
            disabled={busy || !newSpreadsheetTitle.trim()}
          >
            {busy ? 'Creating…' : 'Create new Samparka sheet'}
          </button>
          <p className="spike-copy">
            A new file is created in the signed-in user’s Google Drive.
          </p>
        </div>
      ) : (
        <>
          <p className="connected-state" role="status">
            Backup queue: {queue.pending} pending · {queue.blocked} need review.
          </p>
          <p className="connected-state">
            Selected: <strong>{spreadsheet.name}</strong>
            {token && <span> · short-lived token held in memory</span>}
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              setSpreadsheet(undefined)
              setPreview(undefined)
              setWorksheetChoice('')
              setToken(undefined)
              setConnected(false)
              localStorage.removeItem(savedSheetKey)
            }}
          >
            Disconnect
          </button>
          <button
            className="button button-primary"
            onClick={backUpChanges}
            disabled={busy}
          >
            {busy ? 'Backing up…' : 'Back up pending changes'}
          </button>
          <button
            className="button button-secondary"
            onClick={importContacts}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Import contacts from sheet'}
          </button>
          <button
            className="button button-secondary"
            onClick={loadArchivedContacts}
            disabled={busy}
          >
            {busy ? 'Working…' : 'View archived contacts'}
          </button>
          {queue.blocked > 0 && (
            <button
              className="button button-secondary"
              onClick={retryBlocked}
              disabled={busy}
            >
              Retry blocked changes after review
            </button>
          )}
          <p className="spike-copy">
            Disconnecting clears this browser’s selected-sheet setting and
            access token. It keeps local contacts and queued changes.
          </p>
          {preview ? (
            <div className="google-choice-actions">
              <label className="select-field" htmlFor="worksheet-select">
                Worksheet
                <select
                  id="worksheet-select"
                  value={worksheetChoice}
                  onChange={(event) => setWorksheetChoice(event.target.value)}
                  disabled={busy || preview.worksheets.length === 0}
                >
                  {preview.worksheets.map((worksheet) => (
                    <option key={worksheet.sheetId} value={worksheet.title}>
                      {worksheet.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button button-secondary"
                onClick={selectWorksheet}
                disabled={
                  busy ||
                  !worksheetChoice ||
                  worksheetChoice === spreadsheet.worksheet
                }
              >
                Use selected worksheet
              </button>
            </div>
          ) : (
            <button
              className="button button-secondary"
              onClick={loadWorksheetOptions}
              disabled={busy}
            >
              Choose worksheet
            </button>
          )}
          {preview && (
            <>
              <h2 className="preview-title">
                {preview.title} · {preview.worksheet ?? 'No worksheets'}
              </h2>
              <div
                className="sheet-preview"
                role="region"
                aria-label="Worksheet preview"
              >
                {preview.values.length
                  ? preview.values.map((row, index) => (
                      <div key={index}>{row.join(' · ')}</div>
                    ))
                  : 'Worksheet is empty.'}
              </div>
              <button
                className="button button-secondary"
                disabled={busy || !token}
                onClick={() =>
                  void run('appendSampleRow', async () => {
                    if (!token) return
                    trace('sheets.append.requested')
                    await sheets.appendRow(
                      spreadsheet.id,
                      preview.worksheet ?? spreadsheet.worksheet,
                      {
                        id: crypto.randomUUID(),
                        name: 'Samparka feasibility sample',
                        phoneNumbers: ['+10000000000'],
                        emails: [],
                        tags: ['test'],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      },
                      token.value,
                    )
                    trace('sheets.append.responseReceived')
                    setMessage(
                      'Sample row appended. Remove it manually from the test spreadsheet when finished.',
                    )
                  })
                }
              >
                Append sample row to test sheet
              </button>
            </>
          )}
          {archivedContacts !== null && (
            <section aria-label="Archived contacts" className="contact-list">
              <h2 className="preview-title">Archived contacts</h2>
              {archivedContacts.length === 0 ? (
                <p>No archived contacts in this worksheet.</p>
              ) : (
                archivedContacts.map((contact) => (
                  <div className="contact-card" key={contact.id}>
                    <span>
                      <strong>{contact.name}</strong>
                      <small>
                        Archived{' '}
                        {contact.archivedAt
                          ? new Date(contact.archivedAt).toLocaleDateString()
                          : ''}
                      </small>
                    </span>
                    <button
                      className="button button-secondary"
                      onClick={() => restoreArchivedContact(contact)}
                      disabled={busy}
                    >
                      Restore
                    </button>
                  </div>
                ))
              )}
            </section>
          )}
        </>
      )}
      {busy && (
        <span className="status-message" role="status">
          Working…
        </span>
      )}
      <details className="google-diagnostics">
        <summary>Browser diagnostics</summary>
        <p>
          Safe trace only; access tokens, spreadsheet IDs, and cell contents are
          excluded.
        </p>
        {diagnostics.length === 0 ? (
          <p>No Google actions recorded in this page session.</p>
        ) : (
          <ol>
            {diagnostics.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ol>
        )}
        <button
          className="text-button"
          type="button"
          disabled={diagnostics.length === 0}
          onClick={() =>
            void navigator.clipboard
              .writeText(diagnostics.join('\n'))
              .then(() => setMessage('Diagnostics copied to clipboard.'))
              .catch(() =>
                setMessage(
                  'Could not copy diagnostics; select and copy the trace above.',
                ),
              )
          }
        >
          Copy diagnostics
        </button>
      </details>
    </section>
  )
}
