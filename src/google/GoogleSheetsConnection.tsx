import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GoogleIntegrationError,
  SheetsApi,
  pickSpreadsheet,
  requestGoogleAccessToken,
} from './googleSheets'
import type { SelectedSpreadsheet, SpreadsheetMetadata } from './googleSheets'
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
const syncDestinationKey = 'samparka.google.sync-destination.v1'
const lastBackupKey = 'samparka.google.last-backup.v1'
type SavedSpreadsheet = SelectedSpreadsheet & { worksheet: string }
type QueueSummary = { pending: number; blocked: number }
type BackupRecord = { destination: string; at: number }

function isTokenExpired(token?: { expiresAt: number }): boolean {
  return !token || token.expiresAt <= Date.now()
}

function currentTimestamp(): number {
  return Date.now()
}

function stillTargetsSelectedSpreadsheet(
  spreadsheetId: string,
  worksheet: string,
): boolean {
  try {
    const saved = JSON.parse(
      localStorage.getItem(savedSheetKey) ?? 'null',
    ) as SavedSpreadsheet | null
    const destination = `${spreadsheetId}\n${worksheet}`
    const binding = localStorage.getItem(syncDestinationKey) ?? ''
    return (
      saved?.id === spreadsheetId &&
      saved.worksheet === worksheet &&
      (!binding || binding === destination)
    )
  } catch {
    return false
  }
}

async function verifyDestination(
  selected: SelectedSpreadsheet,
  worksheet: string | undefined,
  accessToken: string,
) {
  const sheetMetadata = await sheets.spreadsheetMetadata(
    selected.id,
    accessToken,
    worksheet,
  )
  if (!sheetMetadata.worksheet)
    throw new GoogleIntegrationError(
      'The spreadsheet has no worksheet. Choose a valid Samparka worksheet.',
      'api',
    )
  await contactAdapter.list(
    { spreadsheetId: selected.id, worksheet: sheetMetadata.worksheet },
    accessToken,
  )
  return { sheetMetadata, worksheet: sheetMetadata.worksheet }
}

export function GoogleSheetsConnection({
  onClose,
  repository,
}: {
  onClose: () => void
  repository: ContactRepository
}) {
  const [token, setToken] = useState<{ value: string; expiresAt: number }>()
  const [connected, setConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [networkWaiting, setNetworkWaiting] = useState(false)
  const [lastBackup, setLastBackup] = useState<BackupRecord | undefined>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(lastBackupKey) ?? 'null',
      ) as BackupRecord | null
      return value && Number.isFinite(value.at) && value.destination
        ? value
        : undefined
    } catch {
      return undefined
    }
  })
  const [syncDestination, setSyncDestination] = useState(
    () => localStorage.getItem(syncDestinationKey) ?? '',
  )
  const [retargetRequired, setRetargetRequired] = useState(false)
  const [needsAttention, setNeedsAttention] = useState(false)
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
  const [metadata, setMetadata] = useState<SpreadsheetMetadata>()
  const [worksheetChoice, setWorksheetChoice] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<QueueSummary>({ pending: 0, blocked: 0 })
  const [archivedContacts, setArchivedContacts] = useState<Contact[] | null>(
    null,
  )
  const [newSpreadsheetTitle, setNewSpreadsheetTitle] =
    useState('Samparka Contacts')
  const connectionEpoch = useRef(0)

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
          const destination = spreadsheet
            ? `${spreadsheet.id}\n${spreadsheet.worksheet}`
            : ''
          const binding = localStorage.getItem(syncDestinationKey) ?? ''
          if (!destination) {
            setRetargetRequired(false)
          } else if (destination === binding) {
            setRetargetRequired(false)
          } else if (binding) {
            if (events.some((event) => event.status !== 'completed')) {
              setRetargetRequired(true)
            } else {
              localStorage.setItem(syncDestinationKey, destination)
              setSyncDestination(destination)
            }
          }
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
  }, [repository, refreshQueue, spreadsheet, syncDestination])

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    const reconcileOtherTab = (event: StorageEvent) => {
      if (event.key === savedSheetKey) {
        connectionEpoch.current += 1
        setToken(undefined)
        setConnected(false)
        setMetadata(undefined)
        if (!event.newValue) {
          setSpreadsheet(undefined)
          setWorksheetChoice('')
          setRetargetRequired(false)
        } else {
          try {
            setSpreadsheet(JSON.parse(event.newValue) as SavedSpreadsheet)
          } catch {
            setSpreadsheet(undefined)
          }
        }
      }
      if (event.key === syncDestinationKey) {
        connectionEpoch.current += 1
        setSyncDestination(event.newValue ?? '')
        setToken(undefined)
        setConnected(false)
      }
    }
    window.addEventListener('storage', reconcileOtherTab)
    return () => window.removeEventListener('storage', reconcileOtherTab)
  }, [])

  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await operation()
    } catch (error) {
      if (error instanceof GoogleIntegrationError && error.code === 'expired')
        setToken(undefined)
      if (
        error instanceof GoogleIntegrationError &&
        (error.code === 'expired' || error.code === 'denied')
      )
        setConnected(false)
      if (
        (error instanceof GoogleIntegrationError &&
          error.code === 'api' &&
          error.status !== 429 &&
          (error.status ?? 0) < 500) ||
        (error instanceof Error && error.name === 'SheetSchemaError')
      )
        setNeedsAttention(true)
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
    if (!connected || !token || !spreadsheet || retargetRequired) return
    const selectedDestination = `${spreadsheet.id}\n${spreadsheet.worksheet}`
    if (syncDestination && selectedDestination !== syncDestination) return
    let cancelled = false
    const syncEpoch = connectionEpoch.current
    const expiryTimer = window.setTimeout(
      () => {
        connectionEpoch.current += 1
        setConnected(false)
        setToken(undefined)
        setSyncing(false)
        setMessage(
          'Google access expired. Reconnect to continue backing up changes.',
        )
      },
      Math.max(0, token.expiresAt - Date.now()),
    )
    let retryTimer: number | undefined
    const scheduleRetry = (retryAt: number) => {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      if (cancelled) return
      retryTimer = window.setTimeout(
        () => {
          retryTimer = undefined
          resumeSync()
        },
        Math.max(0, retryAt - Date.now()),
      )
    }
    const resumeSync = () => {
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
        retryTimer = undefined
      }
      if (!navigator.onLine || document.visibilityState !== 'visible') return
      if (token.expiresAt <= Date.now()) {
        setConnected(false)
        setToken(undefined)
        setMessage(
          'Google access expired. Reconnect to continue backing up changes.',
        )
        return
      }
      setSyncing(true)
      void (async () => {
        const location = {
          spreadsheetId: spreadsheet.id,
          worksheet: spreadsheet.worksheet,
        }
        await verifyDestination(spreadsheet, spreadsheet.worksheet, token.value)
        if (cancelled || connectionEpoch.current !== syncEpoch) return
        setNetworkWaiting(false)
        const result = await syncGoogleChanges(
          repository,
          contactAdapter,
          location,
          token.value,
          Date.now(),
          () =>
            !cancelled &&
            connectionEpoch.current === syncEpoch &&
            navigator.onLine &&
            stillTargetsSelectedSpreadsheet(
              spreadsheet.id,
              spreadsheet.worksheet,
            ),
        )
        await refreshQueue()
        if (cancelled) return
        setSyncing(false)
        const remainingEvents = await repository.listPendingChanges()
        const transientFailure = remainingEvents.some(
          (event) => event.lastError === 'transient',
        )
        setNetworkWaiting(transientFailure)
        const authorizationFailed = remainingEvents.some(
          (event) => event.lastError === 'authorization',
        )
        if (authorizationFailed) {
          setConnected(false)
          setToken(undefined)
          setMessage(
            'Google access was denied or revoked. Reconnect to continue backing up changes.',
          )
        }
        if (result.completed > 0) {
          const completedAt = Date.now()
          const record = { destination: selectedDestination, at: completedAt }
          localStorage.setItem(lastBackupKey, JSON.stringify(record))
          setLastBackup(record)
        }
        if (!authorizationFailed && result.retryAt)
          scheduleRetry(result.retryAt)
        if (authorizationFailed) {
          // The more specific authorization recovery message is already visible.
        } else if (result.busy)
          setMessage('Another Samparka tab is already backing up changes.')
        else if (result.blocked)
          setMessage(`${result.blocked} backup change(s) need review.`)
        else if (result.retryAt)
          setMessage(
            'A backup retry is scheduled automatically after a short delay.',
          )
        else if (result.paused)
          setMessage(
            'Backup is paused until Google access or network connectivity returns.',
          )
      })().catch((error: unknown) => {
        if (cancelled) return
        setSyncing(false)
        if (
          error instanceof GoogleIntegrationError &&
          error.code === 'expired'
        ) {
          setConnected(false)
          setToken(undefined)
        } else if (
          (error instanceof GoogleIntegrationError &&
            error.code === 'api' &&
            error.status !== 429 &&
            (error.status ?? 0) < 500) ||
          (error instanceof Error && error.name === 'SheetSchemaError')
        ) {
          setNeedsAttention(true)
        }
        const transientFailure =
          error instanceof GoogleIntegrationError &&
          (error.code === 'network' ||
            error.status === 429 ||
            (error.status ?? 0) >= 500)
        if (transientFailure) {
          setNetworkWaiting(true)
          scheduleRetry(Date.now() + 5_000)
        }
        setMessage(
          transientFailure
            ? 'Google Sheets is temporarily unavailable. Backup will retry automatically; local contacts remain available.'
            : error instanceof Error
              ? error.message
              : 'Could not resume backup.',
        )
      })
    }
    resumeSync()
    window.addEventListener('online', resumeSync)
    document.addEventListener('visibilitychange', resumeSync)
    return () => {
      cancelled = true
      window.removeEventListener('online', resumeSync)
      document.removeEventListener('visibilitychange', resumeSync)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      window.clearTimeout(expiryTimer)
    }
  }, [
    connected,
    token,
    spreadsheet,
    repository,
    refreshQueue,
    retargetRequired,
    syncDestination,
  ])

  const acceptDestination = async (
    selected: SelectedSpreadsheet,
    worksheet: string,
    expectedEpoch = connectionEpoch.current,
  ): Promise<boolean> => {
    const events = await repository.listChanges()
    if (connectionEpoch.current !== expectedEpoch) return false
    const nextDestination = `${selected.id}\n${worksheet}`
    const existingDestination = localStorage.getItem(syncDestinationKey) ?? ''
    saveSpreadsheet(selected, worksheet)
    setWorksheetChoice(worksheet)
    const unresolved = events.filter((event) => event.status !== 'completed')
    if (
      existingDestination &&
      existingDestination !== nextDestination &&
      unresolved.length
    ) {
      setRetargetRequired(true)
      setMessage(
        `${unresolved.length} pending or blocked change(s) are still associated with the previous spreadsheet. Review the destination and explicitly retarget them before backup can continue.`,
      )
    } else {
      localStorage.setItem(syncDestinationKey, nextDestination)
      setSyncDestination(nextDestination)
      setRetargetRequired(false)
    }
    return true
  }

  const retargetPendingChanges = () => {
    if (!spreadsheet) return
    const destination = `${spreadsheet.id}\n${spreadsheet.worksheet}`
    localStorage.setItem(syncDestinationKey, destination)
    setSyncDestination(destination)
    setRetargetRequired(false)
    setMessage(
      `Pending changes are now explicitly assigned to ${spreadsheet.name} · ${spreadsheet.worksheet}.`,
    )
  }

  const disconnect = () => {
    const confirmed = window.confirm(
      'Disconnect Google Sheets? This clears this browser’s selected spreadsheet and in-memory Google access. It stops new backup attempts and does not modify the Google spreadsheet. Local contacts, queued changes, checkpoints, and backup history will remain on this device.',
    )
    if (!confirmed) return
    connectionEpoch.current += 1
    setSpreadsheet(undefined)
    setMetadata(undefined)
    setWorksheetChoice('')
    setToken(undefined)
    setConnected(false)
    setNeedsAttention(false)
    setSyncing(false)
    setRetargetRequired(false)
    localStorage.removeItem(savedSheetKey)
  }
  const connect = () =>
    void run(async () => {
      const epoch = connectionEpoch.current

      const auth = await requestGoogleAccessToken(config)
      if (connectionEpoch.current !== epoch) return

      setToken({ value: auth.accessToken, expiresAt: auth.expiresAt })

      const selected = await pickSpreadsheet(config, auth.accessToken)
      if (connectionEpoch.current !== epoch) return

      const { sheetMetadata, worksheet } = await verifyDestination(
        selected,
        undefined,
        auth.accessToken,
      )
      if (connectionEpoch.current !== epoch) return
      if (!(await acceptDestination(selected, worksheet, epoch))) return
      setMetadata(sheetMetadata)
      setConnected(true)
      setNeedsAttention(false)

      setMessage(
        `Google access verified for ${selected.name} · ${worksheet}. Backup write access will be confirmed after the next successful write.`,
      )
    })
  const createSpreadsheet = () =>
    void run(async () => {
      const epoch = connectionEpoch.current
      const auth =
        token && !isTokenExpired(token)
          ? token
          : await requestGoogleAccessToken(config)
      if (connectionEpoch.current !== epoch) return
      const accessToken = 'value' in auth ? auth.value : auth.accessToken
      const expiresAt = 'value' in auth ? auth.expiresAt : auth.expiresAt
      setToken({ value: accessToken, expiresAt })

      const selected = await sheets.createSpreadsheet(
        newSpreadsheetTitle.trim(),
        accessToken,
      )
      if (connectionEpoch.current !== epoch) return

      const { sheetMetadata, worksheet } = await verifyDestination(
        selected,
        'Contacts',
        accessToken,
      )
      if (connectionEpoch.current !== epoch) return
      if (!(await acceptDestination(selected, worksheet, epoch))) return
      setMetadata(sheetMetadata)
      setConnected(true)
      setNeedsAttention(false)

      setMessage(
        `Created ${selected.name}. Google access and its Samparka schema are verified; backup write access will be confirmed after the next successful write.`,
      )
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
    const epoch = connectionEpoch.current
    let activeToken = token
    if (isTokenExpired(activeToken)) {
      const auth = await requestGoogleAccessToken(config)
      if (connectionEpoch.current !== epoch)
        throw new GoogleIntegrationError(
          'The connection changed before authorization completed. Please reconnect and try again.',
          'cancelled',
        )
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
      const { sheetMetadata, worksheet } = await verifyDestination(
        picked,
        undefined,
        activeToken.value,
      )
      if (connectionEpoch.current !== epoch)
        throw new GoogleIntegrationError(
          'The connection changed before destination verification completed.',
          'cancelled',
        )
      destination = {
        ...picked,
        worksheet,
      }
      if (!(await acceptDestination(picked, worksheet, epoch)))
        throw new GoogleIntegrationError(
          'The connection changed before destination selection completed.',
          'cancelled',
        )
      setMetadata(sheetMetadata)
      setWorksheetChoice(worksheet)
    }
    const { sheetMetadata, worksheet } = await verifyDestination(
      destination,
      destination.worksheet,
      activeToken.value,
    )
    if (connectionEpoch.current !== epoch)
      throw new GoogleIntegrationError(
        'The connection changed before verification completed. Please reconnect and try again.',
        'cancelled',
      )
    if (worksheet !== destination.worksheet) {
      destination = { ...destination, worksheet }
      if (!(await acceptDestination(destination, worksheet, epoch)))
        throw new GoogleIntegrationError(
          'The connection changed before destination selection completed.',
          'cancelled',
        )
    }
    setMetadata(sheetMetadata)
    setConnected(true)
    return { activeToken, destination }
  }

  const loadWorksheetOptions = () =>
    void run(async () => {
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      const { sheetMetadata } = await verifyDestination(
        destination,
        destination.worksheet,
        activeToken.value,
      )
      if (connectionEpoch.current !== epoch) return
      setMetadata(sheetMetadata)
      setWorksheetChoice(sheetMetadata.worksheet ?? destination.worksheet)
      setConnected(true)
      setNeedsAttention(false)
    })

  const selectWorksheet = () =>
    void run(async () => {
      if (!worksheetChoice) return
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      const { sheetMetadata, worksheet } = await verifyDestination(
        destination,
        worksheetChoice,
        activeToken.value,
      )
      if (connectionEpoch.current !== epoch) return
      if (!(await acceptDestination(destination, worksheet, epoch))) return
      setWorksheetChoice(worksheet)
      setMetadata(sheetMetadata)
      setConnected(true)
      setNeedsAttention(false)
      setNeedsAttention(false)
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
    if (retargetRequired) {
      setMessage(
        'Review the destination and explicitly retarget pending changes before backing them up.',
      )
      return
    }
    const backupEpoch = connectionEpoch.current
    const result = await syncGoogleChanges(
      repository,
      contactAdapter,
      location,
      accessToken,
      undefined,
      () =>
        connectionEpoch.current === backupEpoch &&
        navigator.onLine &&
        stillTargetsSelectedSpreadsheet(
          location.spreadsheetId,
          location.worksheet,
        ),
    )
    await refreshQueue()
    const pendingEvents = await repository.listPendingChanges()
    setNetworkWaiting(
      pendingEvents.some((event) => event.lastError === 'transient'),
    )
    if (result.completed > 0) {
      const completedAt = currentTimestamp()
      const record = {
        destination: `${location.spreadsheetId}\n${location.worksheet}`,
        at: completedAt,
      }
      localStorage.setItem(lastBackupKey, JSON.stringify(record))
      setLastBackup(record)
    }
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
    void run(async () => {
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      if (connectionEpoch.current !== epoch) return
      await backupToDestination(
        {
          spreadsheetId: destination.id,
          worksheet: destination.worksheet,
        },
        activeToken.value,
      )
    })

  const importContacts = () =>
    void run(async () => {
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      if (connectionEpoch.current !== epoch) return
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
    void run(async () => {
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      if (connectionEpoch.current !== epoch) return
      const location = {
        spreadsheetId: destination.id,
        worksheet: destination.worksheet,
      }
      await loadArchivedFromDestination(location, activeToken.value)
    })

  const restoreArchivedContact = (contact: Contact) =>
    void run(async () => {
      const epoch = connectionEpoch.current
      const { activeToken, destination } = await getAuthorizedDestination()
      if (connectionEpoch.current !== epoch) return
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
    void run(async () => {
      const count = await repository.retryBlockedChanges()
      await refreshQueue()
      setMessage(
        count
          ? `${count} change(s) are ready to retry. Review the selected sheet, then choose Back up pending changes.`
          : 'There are no blocked changes to retry.',
      )
    })

  const connectionState = !spreadsheet
    ? busy
      ? 'Checking connection'
      : 'Not connected'
    : offline || networkWaiting
      ? 'Offline / waiting'
      : needsAttention || (connected && (retargetRequired || queue.blocked > 0))
        ? 'Needs attention'
        : !connected
          ? busy
            ? 'Checking connection'
            : 'Reconnect required'
          : syncing
            ? 'Syncing'
            : queue.pending === 0 &&
                queue.blocked === 0 &&
                lastBackup?.destination ===
                  `${spreadsheet.id}\n${spreadsheet.worksheet}`
              ? 'Up to date'
              : 'Connected / ready to sync'
  const connectionExplanation = !spreadsheet
    ? busy
      ? 'Samparka is starting Google authorization or creating the selected destination.'
      : 'Choose a spreadsheet to configure backups.'
    : offline || networkWaiting
      ? offline
        ? 'Google Sheets is unavailable offline. Local contacts and queued changes remain available.'
        : 'Google Sheets is temporarily unavailable. Local contacts and queued changes remain available while backup retries.'
      : needsAttention
        ? 'The selected spreadsheet needs attention. Review the error above, then correct access, worksheet, or schema before retrying.'
        : !connected
          ? busy
            ? 'Samparka is checking Google access and the selected worksheet.'
            : 'This destination is remembered, but Google access is not active in this session. Reconnect to verify it.'
          : retargetRequired
            ? 'Pending changes remain tied to the previous destination. Explicitly retarget them before backup can continue.'
            : queue.blocked > 0
              ? 'Some changes need review before backup can continue.'
              : syncing
                ? 'The durable backup queue is being processed.'
                : queue.pending === 0 &&
                    queue.blocked === 0 &&
                    lastBackup?.destination ===
                      `${spreadsheet.id}\n${spreadsheet.worksheet}`
                  ? 'All queued changes have a confirmed remote completion.'
                  : 'Google access and the selected worksheet schema are verified. Backup write access is confirmed after a successful write.'

  return (
    <section className="form-view" aria-labelledby="google-title">
      <button className="back-button" onClick={onClose}>
        ← <span>Contacts</span>
      </button>
      <p className="eyebrow">Backup destination</p>
      <h1 id="google-title">Google Sheets</h1>
      <p className="google-help">
        Choose an existing worksheet that already uses the Samparka contact
        schema or create a new Samparka spreadsheet. Local contacts remain
        available if Google Sheets is disconnected or offline.
      </p>
      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {!spreadsheet ? (
        <div className="google-choice-actions">
          <section
            className="connected-state"
            aria-label="Google Sheets connection status"
            aria-live="polite"
          >
            <strong>{connectionState}</strong>
            <p>{connectionExplanation}</p>
          </section>
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
          <p className="google-help">
            A new file is created in the signed-in user’s Google Drive.
          </p>
        </div>
      ) : (
        <>
          <section
            className="connected-state"
            aria-label="Google Sheets connection status"
            aria-live="polite"
          >
            <h2>{connectionState}</h2>
            <p>{connectionExplanation}</p>
            <p>
              Spreadsheet:{' '}
              <a
                href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheet.id)}/edit`}
                target="_blank"
                rel="noreferrer"
              >
                {spreadsheet.name}
              </a>
            </p>
            <p>
              Worksheet: <strong>{spreadsheet.worksheet}</strong>
            </p>
            <p>
              Backup queue: {queue.pending} pending · {queue.blocked} blocked.
            </p>
            <p>
              Last successful backup:{' '}
              {lastBackup?.destination ===
              `${spreadsheet.id}\n${spreadsheet.worksheet}`
                ? new Date(lastBackup.at).toLocaleString()
                : 'No confirmed backup yet'}
              .
            </p>
          </section>
          {!connected && (
            <button
              className="button button-primary"
              onClick={loadWorksheetOptions}
              disabled={busy}
            >
              {busy
                ? 'Verifying Google access…'
                : 'Reconnect and verify destination'}
            </button>
          )}
          <button
            className="button button-secondary"
            onClick={connect}
            disabled={busy}
          >
            Connect another spreadsheet
          </button>
          {retargetRequired && (
            <button
              className="button button-primary"
              onClick={retargetPendingChanges}
            >
              Retarget pending and blocked changes to this spreadsheet
            </button>
          )}
          <button className="button button-secondary" onClick={disconnect}>
            Disconnect
          </button>
          <button
            className="button button-primary"
            onClick={backUpChanges}
            disabled={busy || retargetRequired}
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
          {metadata ? (
            <div className="google-choice-actions">
              <label className="select-field" htmlFor="worksheet-select">
                Worksheet
                <select
                  id="worksheet-select"
                  value={worksheetChoice}
                  onChange={(event) => setWorksheetChoice(event.target.value)}
                  disabled={busy || metadata.worksheets.length === 0}
                >
                  {metadata.worksheets.map((worksheet) => (
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
          {metadata && (
            <>
              <h2 className="archive-title">{metadata.title}</h2>
            </>
          )}
          {archivedContacts !== null && (
            <section aria-label="Archived contacts" className="contact-list">
              <h2 className="archive-title">Archived contacts</h2>
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
    </section>
  )
}
