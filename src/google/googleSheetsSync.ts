import type {
  ContactChangeEvent,
  ContactRepository,
} from '../contacts/contactRepository'
import { GOOGLE_SHEETS_CONSUMER_ID } from '../contacts/contactRepository'
import { GoogleIntegrationError } from './googleSheets'
import {
  GoogleSheetsContactAdapter,
  type SheetLocation,
} from './googleSheetsContacts'

type SyncResult = {
  completed: number
  pending: number
  blocked: number
  paused: boolean
  busy: boolean
}

const LEASE_RENEW_INTERVAL_MS = 10_000

const activeRuns = new Map<string, Promise<SyncResult>>()

/** Processes the durable local outbox in sequence. The access token is never persisted. */
export function syncGoogleChanges(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now = Date.now(),
): Promise<SyncResult> {
  const consumerId = GOOGLE_SHEETS_CONSUMER_ID
  const activeRun = activeRuns.get(consumerId)
  if (activeRun) return activeRun
  const run = runWithCrossTabLock(
    repository,
    adapter,
    location,
    token,
    now,
    consumerId,
  ).finally(() => {
    if (activeRuns.get(consumerId) === run) activeRuns.delete(consumerId)
  })
  activeRuns.set(consumerId, run)
  return run
}

async function runWithCrossTabLock(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now: number,
  consumerId: string,
): Promise<SyncResult> {
  if (navigator.locks) {
    return navigator.locks.request(
      `samparka-${consumerId}-sync`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return busyResult(repository, consumerId)
        return processChanges(repository, adapter, location, token, now)
      },
    )
  }

  return runWithLease(repository, adapter, location, token, now, consumerId)
}

async function busyResult(
  repository: ContactRepository,
  consumerId: string,
): Promise<SyncResult> {
  return {
    completed: 0,
    pending: (await repository.listPendingChanges(consumerId)).length,
    blocked: 0,
    paused: true,
    busy: true,
  }
}

async function runWithLease(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now: number,
  consumerId: string,
): Promise<SyncResult> {
  const owner = crypto.randomUUID()
  if (!(await repository.acquireSyncLease(owner, consumerId)))
    return busyResult(repository, consumerId)

  let leaseAlive = true
  const renewLease = async () => {
    if (!leaseAlive) return false
    try {
      leaseAlive = await repository.renewSyncLease(owner, consumerId)
    } catch {
      leaseAlive = false
    }
    return leaseAlive
  }
  const heartbeat = setInterval(() => {
    void renewLease()
  }, LEASE_RENEW_INTERVAL_MS)

  try {
    return await processChanges(
      repository,
      adapter,
      location,
      token,
      now,
      renewLease,
      consumerId,
    )
  } finally {
    clearInterval(heartbeat)
    await repository.releaseSyncLease(owner, consumerId)
  }
}

async function processChanges(
  repository: ContactRepository,
  adapter: GoogleSheetsContactAdapter,
  location: SheetLocation,
  token: string,
  now: number,
  stillOwner: () => Promise<boolean> = async () => true,
  consumerId = GOOGLE_SHEETS_CONSUMER_ID,
): Promise<SyncResult> {
  const events = await repository.listPendingChanges(consumerId)
  let completed = 0
  let blocked = 0
  for (const event of events) {
    if (!(await stillOwner())) {
      return {
        completed,
        pending: (await repository.listPendingChanges(consumerId)).length,
        blocked,
        paused: true,
        busy: true,
      }
    }
    if (event.nextAttemptAt && event.nextAttemptAt > now) break
    try {
      await processEvent(repository, adapter, location, token, event)
      if (!(await stillOwner())) {
        return {
          completed,
          pending: (await repository.listPendingChanges(consumerId)).length,
          blocked,
          paused: true,
          busy: true,
        }
      }
      await repository.updateConsumerChange(consumerId, {
        ...event,
        status: 'completed',
        lastError: undefined,
        nextAttemptAt: undefined,
      })
      completed += 1
    } catch (error) {
      if (!(await stillOwner())) {
        return {
          completed,
          pending: (await repository.listPendingChanges(consumerId)).length,
          blocked,
          paused: true,
          busy: true,
        }
      }
      const result = classifyFailure(error)
      const attempts = event.attempts + 1
      const nextAttemptAt =
        result === 'transient'
          ? now +
            Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 12)) +
            Math.floor(Math.random() * 1_000)
          : undefined
      const failed: ContactChangeEvent = {
        ...event,
        attempts,
        lastError: result,
        ...(result === 'ambiguous' || result === 'permanent'
          ? { status: 'blocked' as const }
          : { status: 'pending' as const }),
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      }
      await repository.updateConsumerChange(consumerId, failed)
      if (failed.status === 'blocked') blocked += 1
      if (result === 'authorization' || result === 'transient') {
        return {
          completed,
          pending: events.length - completed - blocked,
          blocked,
          paused: true,
          busy: false,
        }
      }
    }
  }
  const remaining = (await repository.listPendingChanges(consumerId)).length
  return { completed, pending: remaining, blocked, paused: false, busy: false }
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

function classifyFailure(
  error: unknown,
): NonNullable<ContactChangeEvent['lastError']> {
  if (error instanceof GoogleIntegrationError) {
    if (error.code === 'expired' || error.code === 'denied')
      return 'authorization'
    if (
      error.code === 'network' ||
      error.status === 429 ||
      (error.status ?? 0) >= 500
    )
      return 'transient'
    if (
      error.message.includes('not found') ||
      error.message.includes('missing from the selected sheet')
    )
      return 'ambiguous'
  }
  return error instanceof Error && error.name === 'SheetSchemaError'
    ? 'ambiguous'
    : 'permanent'
}
