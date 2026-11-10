import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { normalizeContact } from './contact'
import type { Contact, ContactInput, ContactUpdate } from './contact'

const DATABASE_NAME = 'samparka'
const DATABASE_VERSION = 2
const CONTACT_STORE = 'contacts'
const OUTBOX_STORE = 'outbox'
const METADATA_STORE = 'metadata'
const SYNC_LEASE_KEY = 'googleSheetsSyncLease'
const SYNC_LEASE_DURATION_MS = 30_000

type SyncLease = { owner: string; expiresAt: number }
export const GOOGLE_SHEETS_CONSUMER_ID = 'googleSheets'

type ConsumerChangeState = {
  status: 'pending' | 'completed' | 'blocked'
  attempts: number
  nextAttemptAt?: number
  lastError?: 'authorization' | 'transient' | 'ambiguous' | 'permanent'
}

export type ContactChangeEvent = {
  schemaVersion: 1
  eventId: string
  sequence: number
  contactId: string
  operation: 'create' | 'update' | 'archive'
  createdAt: number
  status: 'pending' | 'completed' | 'blocked'
  attempts: number
  nextAttemptAt?: number
  lastError?: 'authorization' | 'transient' | 'ambiguous' | 'permanent'
  consumers?: Record<string, ConsumerChangeState>
}

export type ImportResult = {
  imported: number
  preservedLocal: number
  skippedPendingArchive: number
}

interface SamparkaDatabase extends DBSchema {
  contacts: {
    key: string
    value: Contact
    indexes: { 'by-updated-at': number }
  }
  outbox: {
    key: string
    value: ContactChangeEvent
    indexes: { 'by-sequence': number; 'by-status': string }
  }
  metadata: {
    key: string
    value: number | SyncLease
  }
}

export class ContactStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ContactStorageError'
  }
}

export interface ContactRepository {
  create(input: ContactInput): Promise<Contact>
  getById(id: string): Promise<Contact | undefined>
  list(): Promise<Contact[]>
  update(id: string, changes: ContactUpdate): Promise<Contact>
  delete(id: string): Promise<void>
  listPendingChanges(consumerId?: string): Promise<ContactChangeEvent[]>
  listChanges(consumerId?: string): Promise<ContactChangeEvent[]>
  updateChange(event: ContactChangeEvent): Promise<void>
  updateConsumerChange(
    consumerId: string,
    event: ContactChangeEvent,
  ): Promise<void>
  getConsumerCheckpoint(consumerId: string): Promise<number>
  retryBlockedChanges(
    operation?: ContactChangeEvent['operation'],
    consumerId?: string,
  ): Promise<number>
  importRemoteContacts(contacts: readonly Contact[]): Promise<ImportResult>
  acquireSyncLease(owner: string): Promise<boolean>
  renewSyncLease(owner: string): Promise<boolean>
  releaseSyncLease(owner: string): Promise<void>
}

export class IndexedDbContactRepository implements ContactRepository {
  private database?: Promise<IDBPDatabase<SamparkaDatabase>>

  constructor(private readonly databaseName = DATABASE_NAME) {}

  private open(): Promise<IDBPDatabase<SamparkaDatabase>> {
    this.database ??= openDB<SamparkaDatabase>(
      this.databaseName,
      DATABASE_VERSION,
      {
        upgrade(database) {
          if (!database.objectStoreNames.contains(CONTACT_STORE)) {
            const store = database.createObjectStore(CONTACT_STORE, {
              keyPath: 'id',
            })
            store.createIndex('by-updated-at', 'updatedAt')
          }
          if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
            const outbox = database.createObjectStore(OUTBOX_STORE, {
              keyPath: 'eventId',
            })
            outbox.createIndex('by-sequence', 'sequence')
            outbox.createIndex('by-status', 'status')
          }
          if (!database.objectStoreNames.contains(METADATA_STORE)) {
            database.createObjectStore(METADATA_STORE)
          }
        },
      },
    )
    return this.database
  }

  private async run<T>(
    operation: (database: IDBPDatabase<SamparkaDatabase>) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(await this.open())
    } catch (error) {
      if (error instanceof ContactStorageError) throw error
      throw new ContactStorageError(
        'Could not access contacts in browser storage.',
        { cause: error },
      )
    }
  }

  async create(input: ContactInput): Promise<Contact> {
    const normalized = normalizeContact(input)
    const now = Date.now()
    const contact: Contact = {
      ...normalized,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    }
    return this.run(async (database) => {
      const transaction = database.transaction(
        [CONTACT_STORE, OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const lastSequence = await transaction
        .objectStore(METADATA_STORE)
        .get('lastSequence')
      const sequence = (typeof lastSequence === 'number' ? lastSequence : 0) + 1
      const event = this.createEvent(sequence, contact.id, 'create')
      await transaction.objectStore(CONTACT_STORE).add(contact)
      await transaction
        .objectStore(METADATA_STORE)
        .put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
      return contact
    })
  }

  getById(id: string): Promise<Contact | undefined> {
    return this.run((database) => database.get(CONTACT_STORE, id))
  }

  list(): Promise<Contact[]> {
    return this.run(async (database) =>
      (
        await database.getAllFromIndex(CONTACT_STORE, 'by-updated-at')
      ).reverse(),
    )
  }

  async update(id: string, changes: ContactUpdate): Promise<Contact> {
    return this.run(async (database) => {
      const transaction = database.transaction(
        [CONTACT_STORE, OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const contacts = transaction.objectStore(CONTACT_STORE)
      const existing = await contacts.get(id)
      if (!existing)
        throw new ContactStorageError(`Contact “${id}” does not exist.`)
      const normalized = normalizeContact({
        name: changes.name ?? existing.name,
        phoneNumbers: changes.phoneNumbers ?? existing.phoneNumbers,
        emails: changes.emails ?? existing.emails,
        description:
          changes.description === undefined
            ? existing.description
            : changes.description,
        tags: changes.tags ?? existing.tags,
      })
      const updated: Contact = {
        ...normalized,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
      }
      const lastSequence = await transaction
        .objectStore(METADATA_STORE)
        .get('lastSequence')
      const sequence = (typeof lastSequence === 'number' ? lastSequence : 0) + 1
      const event = this.createEvent(sequence, id, 'update')
      await contacts.put(updated)
      await transaction
        .objectStore(METADATA_STORE)
        .put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
      return updated
    })
  }

  async delete(id: string): Promise<void> {
    await this.run(async (database) => {
      const transaction = database.transaction(
        [CONTACT_STORE, OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const contacts = transaction.objectStore(CONTACT_STORE)
      const existing = await contacts.get(id)
      if (!existing) {
        await transaction.done
        return
      }
      const lastSequence = await transaction
        .objectStore(METADATA_STORE)
        .get('lastSequence')
      const sequence = (typeof lastSequence === 'number' ? lastSequence : 0) + 1
      const event = this.createEvent(sequence, id, 'archive')
      await contacts.delete(id)
      await transaction
        .objectStore(METADATA_STORE)
        .put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
    })
  }

  listPendingChanges(
    consumerId = GOOGLE_SHEETS_CONSUMER_ID,
  ): Promise<ContactChangeEvent[]> {
    return this.run(async (database) => {
      const events = await database.getAllFromIndex(OUTBOX_STORE, 'by-sequence')
      return events
        .map((event) => withConsumerState(event, consumerId))
        .filter((event) => event.status === 'pending')
        .sort((a, b) => a.sequence - b.sequence)
    })
  }

  listChanges(
    consumerId = GOOGLE_SHEETS_CONSUMER_ID,
  ): Promise<ContactChangeEvent[]> {
    return this.run(async (database) =>
      (await database.getAllFromIndex(OUTBOX_STORE, 'by-sequence'))
        .map((event) => withConsumerState(event, consumerId))
        .reverse(),
    )
  }

  async updateChange(event: ContactChangeEvent): Promise<void> {
    await this.run((database) => database.put(OUTBOX_STORE, event))
  }

  async updateConsumerChange(
    consumerId: string,
    event: ContactChangeEvent,
  ): Promise<void> {
    await this.run(async (database) => {
      const transaction = database.transaction(
        [OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const outbox = transaction.objectStore(OUTBOX_STORE)
      const stored = await outbox.get(event.eventId)
      if (!stored) {
        await transaction.done
        return
      }
      const consumerState: ConsumerChangeState = {
        status: event.status,
        attempts: event.attempts,
        nextAttemptAt: event.nextAttemptAt,
        lastError: event.lastError,
      }
      const updated: ContactChangeEvent = {
        ...stored,
        consumers: {
          ...stored.consumers,
          [consumerId]: consumerState,
        },
      }
      if (consumerId === GOOGLE_SHEETS_CONSUMER_ID) {
        Object.assign(updated, consumerState)
      }
      await outbox.put(updated)

      const events = (await outbox.getAll()).sort(
        (left, right) => left.sequence - right.sequence,
      )
      const checkpointKey = consumerCheckpointKey(consumerId)
      const storedCheckpoint = await transaction
        .objectStore(METADATA_STORE)
        .get(checkpointKey)
      const previousCheckpoint =
        typeof storedCheckpoint === 'number' ? storedCheckpoint : 0
      let checkpoint = previousCheckpoint
      for (const item of events) {
        if (item.sequence <= checkpoint) continue
        if (item.sequence !== checkpoint + 1) break
        if (withConsumerState(item, consumerId).status !== 'completed') break
        checkpoint = item.sequence
      }
      if (checkpoint > previousCheckpoint)
        await transaction
          .objectStore(METADATA_STORE)
          .put(checkpoint, checkpointKey)
      await transaction.done
    })
  }

  getConsumerCheckpoint(consumerId: string): Promise<number> {
    return this.run(async (database) => {
      const transaction = database.transaction(
        [OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const metadata = transaction.objectStore(METADATA_STORE)
      const key = consumerCheckpointKey(consumerId)
      const stored = await metadata.get(key)
      const previous = typeof stored === 'number' ? stored : 0
      let checkpoint = previous
      const events = (
        await transaction.objectStore(OUTBOX_STORE).getAll()
      ).sort((left, right) => left.sequence - right.sequence)
      for (const event of events) {
        if (event.sequence <= checkpoint) continue
        if (event.sequence !== checkpoint + 1) break
        if (withConsumerState(event, consumerId).status !== 'completed') break
        checkpoint = event.sequence
      }
      if (checkpoint > previous) await metadata.put(checkpoint, key)
      await transaction.done
      return checkpoint
    })
  }

  async retryBlockedChanges(
    operation?: ContactChangeEvent['operation'],
    consumerId = GOOGLE_SHEETS_CONSUMER_ID,
  ): Promise<number> {
    return this.run(async (database) => {
      const transaction = database.transaction(OUTBOX_STORE, 'readwrite')
      const store = transaction.objectStore(OUTBOX_STORE)
      const blocked = (await store.getAll()).filter(
        (event) =>
          withConsumerState(event, consumerId).status === 'blocked' &&
          (operation === undefined || event.operation === operation),
      )
      for (const event of blocked) {
        const consumerState = withConsumerState(event, consumerId)
        const retried: ContactChangeEvent = {
          ...event,
          consumers: {
            ...event.consumers,
            [consumerId]: {
              status: 'pending',
              attempts: consumerState.attempts,
            },
          },
        }
        if (consumerId === GOOGLE_SHEETS_CONSUMER_ID) {
          retried.status = 'pending'
          retried.lastError = undefined
          retried.nextAttemptAt = undefined
        }
        await store.put(retried)
      }
      await transaction.done
      return blocked.length
    })
  }

  async acquireSyncLease(owner: string): Promise<boolean> {
    return this.run(async (database) => {
      const transaction = database.transaction(METADATA_STORE, 'readwrite')
      const store = transaction.objectStore(METADATA_STORE)
      const lease = await store.get(SYNC_LEASE_KEY)
      const now = Date.now()
      if (lease && typeof lease !== 'number' && lease.expiresAt > now) {
        await transaction.done
        return false
      }
      await store.put(
        { owner, expiresAt: now + SYNC_LEASE_DURATION_MS },
        SYNC_LEASE_KEY,
      )
      await transaction.done
      return true
    })
  }

  async renewSyncLease(owner: string): Promise<boolean> {
    return this.run(async (database) => {
      const transaction = database.transaction(METADATA_STORE, 'readwrite')
      const store = transaction.objectStore(METADATA_STORE)
      const lease = await store.get(SYNC_LEASE_KEY)
      const now = Date.now()
      if (
        !lease ||
        typeof lease === 'number' ||
        lease.owner !== owner ||
        lease.expiresAt <= now
      ) {
        await transaction.done
        return false
      }
      await store.put(
        { owner, expiresAt: now + SYNC_LEASE_DURATION_MS },
        SYNC_LEASE_KEY,
      )
      await transaction.done
      return true
    })
  }

  async releaseSyncLease(owner: string): Promise<void> {
    await this.run(async (database) => {
      const transaction = database.transaction(METADATA_STORE, 'readwrite')
      const store = transaction.objectStore(METADATA_STORE)
      const lease = await store.get(SYNC_LEASE_KEY)
      if (lease && typeof lease !== 'number' && lease.owner === owner) {
        await store.delete(SYNC_LEASE_KEY)
      }
      await transaction.done
    })
  }

  async importRemoteContacts(
    remoteContacts: readonly Contact[],
  ): Promise<ImportResult> {
    return this.run(async (database) => {
      const transaction = database.transaction(
        [CONTACT_STORE, OUTBOX_STORE, METADATA_STORE],
        'readwrite',
      )
      const contactsStore = transaction.objectStore(CONTACT_STORE)
      const outboxStore = transaction.objectStore(OUTBOX_STORE)
      const metadataStore = transaction.objectStore(METADATA_STORE)
      const storedSequence = await metadataStore.get('lastSequence')
      let sequence = typeof storedSequence === 'number' ? storedSequence : 0
      const pendingEvents = (await outboxStore.getAll()).filter(
        (event) => event.status === 'pending',
      )
      const pendingContactIds = new Set(
        pendingEvents.map((event) => event.contactId),
      )
      const pendingArchiveIds = new Set(
        pendingEvents
          .filter((event) => event.operation === 'archive')
          .map((event) => event.contactId),
      )
      let imported = 0
      let preservedLocal = 0
      let skippedPendingArchive = 0

      for (const remote of remoteContacts) {
        const local = await contactsStore.get(remote.id)
        if (!local) {
          if (pendingArchiveIds.has(remote.id)) {
            skippedPendingArchive += 1
            continue
          }
          await contactsStore.add(remote)
          imported += 1
          continue
        }

        preservedLocal += 1
        if (!sameContactContent(local, remote)) {
          if (!pendingContactIds.has(local.id)) {
            sequence += 1
            await outboxStore.add(
              this.createEvent(sequence, local.id, 'update'),
            )
            pendingContactIds.add(local.id)
          }
        }
      }

      if (sequence) await metadataStore.put(sequence, 'lastSequence')
      await transaction.done
      return { imported, preservedLocal, skippedPendingArchive }
    })
  }

  private createEvent(
    sequence: number,
    contactId: string,
    operation: ContactChangeEvent['operation'],
  ): ContactChangeEvent {
    return {
      schemaVersion: 1,
      eventId: crypto.randomUUID(),
      sequence,
      contactId,
      operation,
      createdAt: Date.now(),
      status: 'pending',
      attempts: 0,
    }
  }

  async close(): Promise<void> {
    if (!this.database) return
    const database = await this.database
    database.close()
    this.database = undefined
  }
}

function consumerCheckpointKey(consumerId: string): string {
  return `consumerCheckpoint:${consumerId}`
}

function withConsumerState(
  event: ContactChangeEvent,
  consumerId: string,
): ContactChangeEvent {
  const state =
    event.consumers?.[consumerId] ??
    (consumerId === GOOGLE_SHEETS_CONSUMER_ID
      ? {
          status: event.status,
          attempts: event.attempts,
          nextAttemptAt: event.nextAttemptAt,
          lastError: event.lastError,
        }
      : { status: 'pending' as const, attempts: 0 })
  return { ...event, ...state }
}

function sameContactContent(left: Contact, right: Contact): boolean {
  return (
    left.name === right.name &&
    left.description === right.description &&
    sameValues(left.phoneNumbers, right.phoneNumbers) &&
    sameValues(left.emails, right.emails) &&
    sameValues(left.tags, right.tags)
  )
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export const contactRepository = new IndexedDbContactRepository()
