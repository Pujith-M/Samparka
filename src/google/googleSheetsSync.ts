import type { ContactChangeEvent, ContactRepository } from '../contacts/contactRepository'
import { GoogleIntegrationError } from './googleSheets'
import { GoogleSheetsContactAdapter, type SheetLocation } from './googleSheetsContacts'

type SyncResult = { completed: number; pending: number; blocked: number; paused: boolean }

let activeRun: Promise<SyncResult> | undefined

/** Processes the durable local outbox in sequence. The access token is never persisted. */
export function syncGoogleChanges(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now = Date.now(),
): Promise<SyncResult> {
  if (activeRun) return activeRun
  activeRun = processChanges(repository, adapter, location, token, now).finally(() => {
    activeRun = undefined
  })
  return activeRun
}

async function processChanges(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now: number,
): Promise<SyncResult> {
  const events = await repository.listPendingChanges()
  let completed = 0
  let blocked = 0
  for (const event of events) {
    if (event.nextAttemptAt && event.nextAttemptAt > now) break
    try {
      await processEvent(repository, adapter, location, token, event)
      await repository.updateChange({ ...event, status: 'completed', lastError: undefined, nextAttemptAt: undefined })
      completed += 1
    } catch (error) {
      const result = classifyFailure(error)
      const attempts = event.attempts + 1
      const nextAttemptAt = result === 'transient'
        ? now + Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 12)) + Math.floor(Math.random() * 1_000)
        : undefined
      const failed: ContactChangeEvent = {
        ...event,
        attempts,
        lastError: result,
        ...(result === 'ambiguous' || result === 'permanent' ? { status: 'blocked' as const } : { status: 'pending' as const }),
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      }
      await repository.updateChange(failed)
      if (failed.status === 'blocked') blocked += 1
      if (result === 'authorization' || result === 'transient') {
        return { completed, pending: events.length - completed - blocked, blocked, paused: true }
      }
    }
  }
  const remaining = (await repository.listPendingChanges()).length
  return { completed, pending: remaining, blocked, paused: false }
}

async function processEvent(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  event: ContactChangeEvent,
): Promise<void> {
  if (event.operation === 'archive') {
    await adapter.archiveIfPresent(location, event.contactId, token)
    return
  }
  const contact = await repository.getById(event.contactId)
  // If a later local delete removed the record before the queue reached this
  // event, the following archive event represents the final desired state.
  if (!contact) return
  await adapter.converge(location, contact, token, event.operation === 'create')
}

function classifyFailure(error: unknown): NonNullable<ContactChangeEvent['lastError']> {
  if (error instanceof GoogleIntegrationError) {
    if (error.code === 'expired' || error.code === 'denied') return 'authorization'
    if (error.code === 'network' || error.status === 429 || (error.status ?? 0) >= 500) return 'transient'
    if (error.message.includes('not found') || error.message.includes('missing from the selected sheet')) return 'ambiguous'
  }
  return error instanceof Error && error.name === 'SheetSchemaError' ? 'ambiguous' : 'permanent'
}
