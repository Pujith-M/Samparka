import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import { normalizeContact } from './contact'
import type { Contact, ContactInput, ContactUpdate } from './contact'

const DATABASE_NAME = 'samparka'
const DATABASE_VERSION = 2
const CONTACT_STORE = 'contacts'
const OUTBOX_STORE = 'outbox'
const METADATA_STORE = 'metadata'

export type ContactChangeEvent = {
  eventId: string
  sequence: number
  contactId: string
  operation: 'create' | 'update' | 'archive'
  createdAt: number
  status: 'pending' | 'completed' | 'blocked'
  attempts: number
  nextAttemptAt?: number
  lastError?: 'authorization' | 'transient' | 'ambiguous' | 'permanent'
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
    value: number
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
  listPendingChanges(): Promise<ContactChangeEvent[]>
  updateChange(event: ContactChangeEvent): Promise<void>
}

export class IndexedDbContactRepository implements ContactRepository {
  private database?: Promise<IDBPDatabase<SamparkaDatabase>>

  constructor(private readonly databaseName = DATABASE_NAME) {}

  private open(): Promise<IDBPDatabase<SamparkaDatabase>> {
    this.database ??= openDB<SamparkaDatabase>(this.databaseName, DATABASE_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(CONTACT_STORE)) {
          const store = database.createObjectStore(CONTACT_STORE, { keyPath: 'id' })
          store.createIndex('by-updated-at', 'updatedAt')
        }
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          const outbox = database.createObjectStore(OUTBOX_STORE, { keyPath: 'eventId' })
          outbox.createIndex('by-sequence', 'sequence')
          outbox.createIndex('by-status', 'status')
        }
        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          database.createObjectStore(METADATA_STORE)
        }
      },
    })
    return this.database
  }

  private async run<T>(operation: (database: IDBPDatabase<SamparkaDatabase>) => Promise<T>): Promise<T> {
    try {
      return await operation(await this.open())
    } catch (error) {
      if (error instanceof ContactStorageError) throw error
      throw new ContactStorageError('Could not access contacts in browser storage.', { cause: error })
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
      const transaction = database.transaction([CONTACT_STORE, OUTBOX_STORE, METADATA_STORE], 'readwrite')
      const sequence = (await transaction.objectStore(METADATA_STORE).get('lastSequence') ?? 0) + 1
      const event = this.createEvent(sequence, contact.id, 'create')
      await transaction.objectStore(CONTACT_STORE).add(contact)
      await transaction.objectStore(METADATA_STORE).put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
      return contact
    })
  }

  getById(id: string): Promise<Contact | undefined> {
    return this.run((database) => database.get(CONTACT_STORE, id))
  }

  list(): Promise<Contact[]> {
    return this.run(async (database) => (await database.getAllFromIndex(CONTACT_STORE, 'by-updated-at')).reverse())
  }

  async update(id: string, changes: ContactUpdate): Promise<Contact> {
    return this.run(async (database) => {
      const transaction = database.transaction([CONTACT_STORE, OUTBOX_STORE, METADATA_STORE], 'readwrite')
      const contacts = transaction.objectStore(CONTACT_STORE)
      const existing = await contacts.get(id)
      if (!existing) throw new ContactStorageError(`Contact “${id}” does not exist.`)
      const normalized = normalizeContact({
        name: changes.name ?? existing.name,
        phoneNumbers: changes.phoneNumbers ?? existing.phoneNumbers,
        emails: changes.emails ?? existing.emails,
        description: changes.description === undefined ? existing.description : changes.description,
        tags: changes.tags ?? existing.tags,
      })
      const updated: Contact = {
        ...normalized,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
      }
      const sequence = (await transaction.objectStore(METADATA_STORE).get('lastSequence') ?? 0) + 1
      const event = this.createEvent(sequence, id, 'update')
      await contacts.put(updated)
      await transaction.objectStore(METADATA_STORE).put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
      return updated
    })
  }

  async delete(id: string): Promise<void> {
    await this.run(async (database) => {
      const transaction = database.transaction([CONTACT_STORE, OUTBOX_STORE, METADATA_STORE], 'readwrite')
      const contacts = transaction.objectStore(CONTACT_STORE)
      const existing = await contacts.get(id)
      if (!existing) {
        await transaction.done
        return
      }
      const sequence = (await transaction.objectStore(METADATA_STORE).get('lastSequence') ?? 0) + 1
      const event = this.createEvent(sequence, id, 'archive')
      await contacts.delete(id)
      await transaction.objectStore(METADATA_STORE).put(sequence, 'lastSequence')
      await transaction.objectStore(OUTBOX_STORE).add(event)
      await transaction.done
    })
  }

  listPendingChanges(): Promise<ContactChangeEvent[]> {
    return this.run(async (database) => (await database.getAllFromIndex(OUTBOX_STORE, 'by-status', 'pending')).sort((a, b) => a.sequence - b.sequence))
  }

  async updateChange(event: ContactChangeEvent): Promise<void> {
    await this.run((database) => database.put(OUTBOX_STORE, event))
  }

  private createEvent(sequence: number, contactId: string, operation: ContactChangeEvent['operation']): ContactChangeEvent {
    return { eventId: crypto.randomUUID(), sequence, contactId, operation, createdAt: Date.now(), status: 'pending', attempts: 0 }
  }

  async close(): Promise<void> {
    if (!this.database) return
    const database = await this.database
    database.close()
    this.database = undefined
  }
}

export const contactRepository = new IndexedDbContactRepository()
