import { useState } from 'react'
import {
  GoogleIntegrationError,
  SheetsApi,
  pickSpreadsheet,
  requestGoogleAccessToken,
} from './googleSheets'
import type { SelectedSpreadsheet, SheetPreview } from './googleSheets'
import { GoogleSheetsContactAdapter } from './googleSheetsContacts'
import { syncGoogleChanges } from './googleSheetsSync'
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

export function GoogleSheetsSpike({ onClose, repository }: { onClose: () => void; repository: ContactRepository }) {
  const [token, setToken] = useState<{ value: string; expiresAt: number }>()
  const [spreadsheet, setSpreadsheet] = useState<SavedSpreadsheet | undefined>(() => {
    try {
      const value = localStorage.getItem(savedSheetKey)
      return value ? JSON.parse(value) as SavedSpreadsheet : undefined
    } catch { return undefined }
  })
  const [preview, setPreview] = useState<SheetPreview>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] =
    useState('Samparka Contacts')

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
      saveSpreadsheet(selected, sheetPreview.worksheets[0]?.title ?? 'Sheet1')
      setPreview(sheetPreview)
      trace('preview.completed')
      setMessage(
        `Connected to ${selected.name}. The access token stays in memory and expires automatically.`,
      )
    })
  const createSpreadsheet = () =>
    void run('createSpreadsheet', async () => {
      if (!token) trace('authorization.requested')
      const auth = token ?? (await requestGoogleAccessToken(config))
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
      saveSpreadsheet(selected, sheetPreview.worksheets[0]?.title ?? 'Sheet1')
      setPreview(sheetPreview)
      trace('preview.completed')
      setMessage(`Created and selected ${selected.name} in your Google Drive.`)
    })

  const saveSpreadsheet = (selected: SelectedSpreadsheet, worksheet: string) => {
    const saved = { ...selected, worksheet }
    setSpreadsheet(saved)
    localStorage.setItem(savedSheetKey, JSON.stringify(saved))
  }

  const backUpChanges = () => void run('backupChanges', async () => {
    let activeToken = token
    if (!activeToken || activeToken.expiresAt <= Date.now()) {
      const auth = await requestGoogleAccessToken(config)
      activeToken = { value: auth.accessToken, expiresAt: auth.expiresAt }
      setToken(activeToken)
    }
    let destination = spreadsheet
    if (!destination) {
      const picked = await pickSpreadsheet(config, activeToken.value)
      const sheetPreview = await sheets.preview(picked.id, activeToken.value)
      destination = { ...picked, worksheet: sheetPreview.worksheets[0]?.title ?? 'Sheet1' }
      saveSpreadsheet(picked, destination.worksheet)
      setPreview(sheetPreview)
    }
    const result = await syncGoogleChanges(repository, contactAdapter, {
      spreadsheetId: destination.id,
      worksheet: destination.worksheet,
    }, activeToken.value)
    setMessage(result.blocked
      ? `${result.completed} change(s) backed up; ${result.blocked} need review.`
      : result.paused
        ? `${result.completed} change(s) backed up. Remaining changes are waiting to retry or reconnect.`
        : `${result.completed} change(s) backed up; ${result.pending} remain pending.`)
  })

  return (
    <section className="form-view" aria-labelledby="google-title">
      <button className="back-button" onClick={onClose}>
        ← <span>Contacts</span>
      </button>
      <p className="eyebrow">Feasibility spike</p>
      <h1 id="google-title">Google Sheets</h1>
      <p className="spike-copy">
        Choose one of two supported options: connect an existing worksheet that
        already uses the complete Samparka schema, or create a new Samparka
        worksheet. Individual columns are never added to an existing sheet.
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
          <p className="connected-state">
            Selected: <strong>{spreadsheet.name}</strong>
            {token && <span> · short-lived token held in memory</span>}
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              setSpreadsheet(undefined)
              setPreview(undefined)
              setToken(undefined)
              localStorage.removeItem(savedSheetKey)
            }}
          >
            Disconnect
          </button>
          <button className="button button-primary" onClick={backUpChanges} disabled={busy}>
            {busy ? 'Backing up…' : 'Back up pending changes'}
          </button>
          {preview && (
            <>
              <h2 className="preview-title">
                {preview.title} ·{' '}
                {preview.worksheets[0]?.title ?? 'No worksheets'}
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
                      preview.worksheets[0]?.title ?? 'Sheet1',
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
