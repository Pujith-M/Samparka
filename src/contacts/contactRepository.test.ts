import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { ContactValidationError } from './contact'
import {
  ContactStorageError,
  IndexedDbContactRepository,
} from './contactRepository'

const databaseName = 'samparka-test-contacts'
const repository = new IndexedDbContactRepository(databaseName)

afterEach(async () => {
  await repository.close()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('contact model and IndexedDB repository', () => {
  it('rejects missing names and phone numbers with useful validation errors', async () => {
    await expect(
      repository.create({ name: '  ', phoneNumbers: ['123'] }),
    ).rejects.toThrow(ContactValidationError)
    await expect(
      repository.create({ name: 'Mira', phoneNumbers: ['  '] }),
    ).rejects.toThrow(/at least one non-empty phone number/i)
  })

  it('normalizes optional fields and deduplicates tags case-insensitively', async () => {
    const contact = await repository.create({
      name: '  Mira Rao  ',
      phoneNumbers: [' +001 23 ', '555 0100'],
      emails: [' mira@example.com ', ''],
      description: '  School friend  ',
      tags: ['Friend', ' friend ', 'Work'],
    })

    expect(contact).toMatchObject({
      name: 'Mira Rao',
      phoneNumbers: ['+001 23', '555 0100'],
      emails: ['mira@example.com'],
      description: 'School friend',
      tags: ['Friend', 'Work'],
    })
    expect(contact.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(contact.createdAt).toBe(contact.updatedAt)
  })

  it('supports create, get, list, update, and delete while preserving identity and creation time', async () => {
    const original = await repository.create({
      name: 'Mira',
      phoneNumbers: ['00123'],
    })
    expect(await repository.getById(original.id)).toEqual(original)
    expect(await repository.list()).toEqual([original])

    const updated = await repository.update(original.id, {
      name: 'Mira Rao',
      tags: ['Friend'],
    })
    expect(updated).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      name: 'Mira Rao',
    })
    expect(updated.updatedAt).toBeGreaterThan(original.updatedAt)
    expect(await repository.getById(original.id)).toEqual(updated)

    await repository.delete(original.id)
    expect(await repository.getById(original.id)).toBeUndefined()
    expect(await repository.list()).toEqual([])
  })

  it('writes ordered, PII-free change events with each local mutation', async () => {
    const original = await repository.create({
      name: 'Mira',
      phoneNumbers: ['00123'],
    })
    await repository.update(original.id, { name: 'Mira Rao' })
    await repository.delete(original.id)

    const events = await repository.listPendingChanges()
    expect(
      events.map(({ sequence, contactId, operation, status, attempts }) => ({
        sequence,
        contactId,
        operation,
        status,
        attempts,
      })),
    ).toEqual([
      {
        sequence: 1,
        contactId: original.id,
        operation: 'create',
        status: 'pending',
        attempts: 0,
      },
      {
        sequence: 2,
        contactId: original.id,
        operation: 'update',
        status: 'pending',
        attempts: 0,
      },
      {
        sequence: 3,
        contactId: original.id,
        operation: 'archive',
        status: 'pending',
        attempts: 0,
      },
    ])
    expect(
      events.every((event) => !('name' in event) && !('phoneNumbers' in event)),
    ).toBe(true)
  })

  it('keeps consumer progress independent and advances checkpoints contiguously', async () => {
    await repository.create({ name: 'First', phoneNumbers: ['111'] })
    await repository.create({ name: 'Second', phoneNumbers: ['222'] })
    const [first, second] = await repository.listPendingChanges()

    await repository.updateConsumerChange('analytics', {
      ...second,
      status: 'completed',
    })
    expect(await repository.getConsumerCheckpoint('analytics')).toBe(0)
    expect(await repository.listPendingChanges('analytics')).toMatchObject([
      { eventId: first.eventId, status: 'pending' },
    ])
    expect(await repository.listPendingChanges()).toHaveLength(2)

    await repository.updateConsumerChange('analytics', {
      ...first,
      status: 'completed',
    })
    expect(await repository.getConsumerCheckpoint('analytics')).toBe(2)
    expect(await repository.getConsumerCheckpoint('googleSheets')).toBe(0)

    await repository.updateConsumerChange('googleSheets', {
      ...first,
      status: 'completed',
    })
    expect(await repository.getConsumerCheckpoint('googleSheets')).toBe(1)
    expect(await repository.getConsumerCheckpoint('analytics')).toBe(2)
    expect(await repository.listPendingChanges()).toMatchObject([
      { eventId: second.eventId, status: 'pending' },
    ])
  })

  it('does not enqueue a delete for a missing contact', async () => {
    await repository.delete('missing-contact')
    expect(await repository.listPendingChanges()).toEqual([])
  })

  it('imports remote-only contacts while preserving local records with the same ID', async () => {
    const local = await repository.create({
      name: 'Local version',
      phoneNumbers: ['111'],
    })
    const remoteOnly = {
      id: 'remote-only',
      name: 'Remote contact',
      phoneNumbers: ['222'],
      emails: [],
      tags: ['Imported'],
      createdAt: 10,
      updatedAt: 20,
    }
    const remoteConflict = {
      ...local,
      name: 'Remote version',
      phoneNumbers: ['333'],
      updatedAt: local.updatedAt + 1,
    }
    const [createEvent] = await repository.listPendingChanges()
    await repository.updateChange({ ...createEvent, status: 'completed' })

    const result = await repository.importRemoteContacts([
      remoteOnly,
      remoteConflict,
    ])

    expect(result).toEqual({
      imported: 1,
      preservedLocal: 1,
      skippedPendingArchive: 0,
    })
    expect(await repository.getById(remoteOnly.id)).toEqual(remoteOnly)
    expect(await repository.getById(local.id)).toEqual(local)
    expect(
      (await repository.listPendingChanges()).map(
        ({ operation, contactId }) => ({ operation, contactId }),
      ),
    ).toEqual([{ operation: 'update', contactId: local.id }])
  })

  it('does not reimport a remotely visible contact with a pending local archive', async () => {
    const contact = await repository.create({
      name: 'Mira',
      phoneNumbers: ['00123'],
    })
    await repository.delete(contact.id)

    const result = await repository.importRemoteContacts([contact])

    expect(result).toEqual({
      imported: 0,
      preservedLocal: 0,
      skippedPendingArchive: 1,
    })
    expect(await repository.getById(contact.id)).toBeUndefined()
  })

  it('requeues blocked changes only after an explicit retry request', async () => {
    const contact = await repository.create({
      name: 'Mira',
      phoneNumbers: ['00123'],
    })
    const [event] = await repository.listPendingChanges()
    await repository.updateChange({
      ...event,
      status: 'blocked',
      lastError: 'ambiguous',
    })

    expect(await repository.listPendingChanges()).toEqual([])
    expect(await repository.retryBlockedChanges()).toBe(1)
    expect(await repository.listPendingChanges()).toMatchObject([
      { contactId: contact.id, status: 'pending', lastError: undefined },
    ])
  })

  it('can retry only blocked changes of the explicitly reviewed operation', async () => {
    const archived = await repository.create({
      name: 'Archived',
      phoneNumbers: ['111'],
    })
    await repository.delete(archived.id)
    const edited = await repository.create({
      name: 'Edited',
      phoneNumbers: ['222'],
    })
    await repository.update(edited.id, { name: 'Edited locally' })

    const events = await repository.listChanges()
    for (const event of events) {
      if (event.operation === 'archive' || event.operation === 'update') {
        await repository.updateChange({
          ...event,
          status: 'blocked',
          lastError: 'ambiguous',
        })
      }
    }

    expect(await repository.retryBlockedChanges('archive')).toBe(1)
    const afterRetry = await repository.listChanges()
    expect(
      afterRetry.find((event) => event.operation === 'update'),
    ).toMatchObject({ status: 'blocked', lastError: 'ambiguous' })
    expect(
      afterRetry.find((event) => event.operation === 'archive'),
    ).toMatchObject({ status: 'pending', lastError: undefined })
  })

  it('keeps contacts after closing and reopening the database', async () => {
    const original = await repository.create({
      name: 'Mira',
      phoneNumbers: ['00123'],
    })
    await repository.close()

    expect(await repository.getById(original.id)).toEqual(original)
  })

  it('isolates fallback sync leases by consumer', async () => {
    expect(await repository.acquireSyncLease('google-tab-a')).toBe(true)
    expect(await repository.acquireSyncLease('google-tab-b')).toBe(false)
    expect(
      await repository.acquireSyncLease('analytics-tab', 'analytics'),
    ).toBe(true)

    await repository.releaseSyncLease('google-tab-a')
    expect(await repository.acquireSyncLease('google-tab-b')).toBe(true)
    expect(await repository.renewSyncLease('analytics-tab', 'analytics')).toBe(
      true,
    )
    expect(await repository.renewSyncLease('google-tab-b', 'analytics')).toBe(
      false,
    )
  })

  it('surfaces browser storage failures through a repository error', async () => {
    const originalIndexedDb = globalThis.indexedDB
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: undefined,
    })
    try {
      const brokenRepository = new IndexedDbContactRepository(
        'storage-unavailable',
      )
      await expect(brokenRepository.list()).rejects.toThrow(ContactStorageError)
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      })
    }
  })
})
