import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ContactValidationError, normalizeContact } from './contacts/contact'
import type { Contact, ContactInput } from './contacts/contact'
import { contactRepository } from './contacts/contactRepository'
import type { ContactRepository } from './contacts/contactRepository'

type View = 'recent' | 'contacts' | 'add' | 'detail' | 'edit'
type FormValues = ContactInput
type FormField = 'name' | 'phoneNumbers' | 'emails' | 'tags'
type FieldErrors = Partial<Record<FormField, string>>

type ContactFormProps = {
  initialValues?: Contact
  busy: boolean
  error: string | null
  onCancel: () => void
  onSave: (values: FormValues) => Promise<void>
}

const emptyValues: FormValues = { name: '', phoneNumbers: [''], emails: [''], description: '', tags: [] }

const toFormValues = (contact?: Contact): FormValues => contact ? {
  name: contact.name,
  phoneNumbers: contact.phoneNumbers.length ? contact.phoneNumbers : [''],
  emails: contact.emails.length ? contact.emails : [''],
  description: contact.description ?? '',
  tags: contact.tags,
} : emptyValues

function ContactForm({ initialValues, busy, error, onCancel, onSave }: ContactFormProps) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(initialValues))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const getFieldErrors = (message: string): FieldErrors => {
    if (message === 'Name is required.') return { name: message }
    if (message.includes('phone number')) return { phoneNumbers: message }
    if (message.includes('email address')) return { emails: message }
    if (message.startsWith('Tags')) return { tags: message }
    return {}
  }

  // Form state must reset when switching between add and edit modes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setValues(toFormValues(initialValues)), [initialValues])

  const updateList = (field: 'phoneNumbers' | 'emails', index: number, value: string) => {
    setValues((current) => ({ ...current, [field]: (current[field] ?? []).map((item, itemIndex) => itemIndex === index ? value : item) }))
  }
  const addListItem = (field: 'phoneNumbers' | 'emails') => setValues((current) => ({ ...current, [field]: [...(current[field] ?? []), ''] }))
  const removeListItem = (field: 'phoneNumbers' | 'emails', index: number) => setValues((current) => ({ ...current, [field]: (current[field] ?? []).filter((_, itemIndex) => itemIndex !== index) }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setValidationError(null)
    setFieldErrors({})
    try {
      const normalized = normalizeContact({ ...values, tags: values.tags ?? [] })
      await onSave(normalized)
    } catch (saveError) {
      if (saveError instanceof ContactValidationError) {
        setValidationError(saveError.message)
        setFieldErrors(getFieldErrors(saveError.message))
      } else {
        setValidationError('Could not save this contact. Your entries are still here to retry.')
      }
    }
  }

  return <form className="contact-form" onSubmit={submit} noValidate aria-busy={busy}>
    {(validationError || error) && <div id="contact-form-error" className="alert alert-error" role="alert">{validationError || error}</div>}
    {fieldErrors.name && <span id="name-error" className="field-error">{fieldErrors.name}</span>}
    <label htmlFor="contact-name">Name <span className="required">Required</span><input id="contact-name" autoFocus name="name" value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Full name" aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'name-error' : undefined} /></label>
    <fieldset aria-describedby={fieldErrors.phoneNumbers ? 'phone-error' : undefined}><legend>Phone numbers <span className="required">At least one required</span></legend>{values.phoneNumbers.map((phone, index) => <div className="repeat-row" key={`phone-${index}`}><input aria-label={`Phone number ${index + 1}`} aria-invalid={Boolean(fieldErrors.phoneNumbers)} aria-describedby={fieldErrors.phoneNumbers ? 'phone-error' : undefined} type="tel" value={phone} onChange={(event) => updateList('phoneNumbers', index, event.target.value)} placeholder="Phone number" />{values.phoneNumbers.length > 1 && <button type="button" className="remove-button" onClick={() => removeListItem('phoneNumbers', index)} aria-label={`Remove phone number ${index + 1}`}>Remove</button>}</div>)}{fieldErrors.phoneNumbers && <span id="phone-error" className="field-error">{fieldErrors.phoneNumbers}</span>}<button type="button" className="text-button" onClick={() => addListItem('phoneNumbers')}>+ Add phone number</button></fieldset>
    <fieldset aria-describedby={fieldErrors.emails ? 'email-error' : undefined}><legend>Email addresses <span className="optional">Optional</span></legend>{(values.emails ?? []).map((email, index) => <div className="repeat-row" key={`email-${index}`}><input aria-label={`Email address ${index + 1}`} aria-invalid={Boolean(fieldErrors.emails)} aria-describedby={fieldErrors.emails ? 'email-error' : undefined} type="email" value={email} onChange={(event) => updateList('emails', index, event.target.value)} placeholder="Email address" />{(values.emails ?? []).length > 1 && <button type="button" className="remove-button" onClick={() => removeListItem('emails', index)} aria-label={`Remove email address ${index + 1}`}>Remove</button>}</div>)}{fieldErrors.emails && <span id="email-error" className="field-error">{fieldErrors.emails}</span>}<button type="button" className="text-button" onClick={() => addListItem('emails')}>+ Add email address</button></fieldset>
    <label htmlFor="contact-description">Description <span className="optional">Optional · brief context about this person</span><textarea id="contact-description" value={values.description ?? ''} onChange={(event) => setValues({ ...values, description: event.target.value })} placeholder="What should you remember about this person?" rows={4} /></label>
    <label>Tags <span className="optional">Optional, comma separated</span><input value={(values.tags ?? []).join(', ')} onChange={(event) => setValues({ ...values, tags: event.target.value.split(',') })} placeholder="Friend, work" /></label>
    <div className="form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : initialValues ? 'Save changes' : 'Save contact'}</button></div>
  </form>
}

function ContactDetail({ contact, onBack, onEdit, onDelete }: { contact: Contact; onBack: () => void; onEdit: () => void; onDelete: () => void }) {
  return <section className="detail-view" aria-labelledby="detail-title"><button className="back-button" onClick={onBack}>← <span>Contacts</span></button><div className="detail-heading"><div className="avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</div><div><p className="eyebrow">Contact</p><h1 id="detail-title">{contact.name}</h1></div></div><div className="detail-card">{contact.phoneNumbers.length > 0 && <DetailRow label="Phone" values={contact.phoneNumbers} />}{contact.emails.length > 0 && <DetailRow label="Email" values={contact.emails} />}{contact.description && <DetailRow label="Description" values={[contact.description]} />}{contact.tags.length > 0 && <div className="detail-row"><span>Tags</span><div className="tags">{contact.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div></div>}</div><div className="detail-actions"><button className="button button-secondary" onClick={onDelete}>Delete contact</button><button className="button button-primary" onClick={onEdit}>Edit contact</button></div></section>
}
function DetailRow({ label, values }: { label: string; values: string[] }) { return <div className="detail-row"><span>{label}</span><div>{values.map((value) => <p key={value}>{value}</p>)}</div></div> }

function App({ repository = contactRepository }: { repository?: ContactRepository }) {
  const [view, setView] = useState<View>('contacts')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selected, setSelected] = useState<Contact | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadContacts = useCallback(async () => { setLoading(true); setError(null); try { setContacts(await repository.list()) } catch { setError('Your contacts could not be loaded. Try again.') } finally { setLoading(false) } }, [repository])
  // Load persisted contacts when the repository changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadContacts() }, [loadContacts])

  const saveContact = async (values: FormValues) => { setBusy(true); setError(null); try { const saved = selected ? await repository.update(selected.id, values) : await repository.create(values); setSelected(saved); await loadContacts(); setView('detail') } catch { setError('The contact could not be saved. Your entries are still here to retry.') } finally { setBusy(false) } }
  const openContact = async (contact: Contact) => { setError(null); try { const latest = await repository.getById(contact.id); if (!latest) { setError('This contact no longer exists.'); await loadContacts(); return } setSelected(latest); setView('detail') } catch { setError('This contact could not be opened.') } }
  const deleteContact = async () => { if (!selected || !window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return; setBusy(true); try { await repository.delete(selected.id); setSelected(undefined); await loadContacts(); setView('contacts') } catch { setError('The contact was not deleted. Try again.') } finally { setBusy(false) } }
  const pageTitle = view === 'recent' ? 'Recent' : 'Contacts'

  return <div className="app-shell"><header className="app-header"><a className="brand" href="#contacts" onClick={() => setView('contacts')} aria-label="Samparka contacts"><span className="brand-mark" aria-hidden="true">s</span><span>samparka</span></a><button className="icon-button" aria-label="More options">•••</button></header><main className="main-content">
    {view === 'detail' && selected ? <ContactDetail contact={selected} onBack={() => setView('contacts')} onEdit={() => setView('edit')} onDelete={() => void deleteContact()} /> : view === 'add' || view === 'edit' ? <section className="form-view" aria-labelledby="form-title"><button className="back-button" onClick={() => setView(selected ? 'detail' : 'contacts')}>← <span>{selected ? 'Contact' : 'Contacts'}</span></button><p className="eyebrow">{selected ? 'Update connection' : 'New connection'}</p><h1 id="form-title">{selected ? 'Edit contact' : 'Add contact'}</h1><ContactForm initialValues={selected} busy={busy} error={error} onCancel={() => setView(selected ? 'detail' : 'contacts')} onSave={saveContact} /></section> : <><div className="view-heading"><div><p className="eyebrow">Your people</p><h1>{pageTitle}</h1></div>{view === 'contacts' && <button className="search-button" aria-label="Search contacts">⌕ <span>Search</span></button>}</div>{error && <div className="alert alert-error" role="alert">{error} <button className="text-button" onClick={() => void loadContacts()}>Retry</button></div>}{view === 'recent' ? <EmptyState title="Nothing recent yet" text="New and updated contacts will appear here." /> : loading ? <p className="status-message" role="status">Loading contacts…</p> : contacts.length === 0 && !error ? <EmptyState title="Your circle starts here" text="Add the people who matter to you. Your contacts stay stored on this device." onAdd={() => setView('add')} /> : <div className="contact-list">{contacts.map((contact) => <button className="contact-card" key={contact.id} onClick={() => void openContact(contact)}><span className="avatar" aria-hidden="true">{contact.name.slice(0, 1).toUpperCase()}</span><span><strong>{contact.name}</strong><small>{contact.phoneNumbers[0]}</small></span><span className="chevron" aria-hidden="true">→</span></button>)}<button className="button button-primary add-another" onClick={() => { setSelected(undefined); setView('add') }}>+ Add contact</button></div>}</>}
  </main><nav className="bottom-nav" aria-label="Primary navigation">{[['recent', 'Recent', '◷'], ['contacts', 'Contacts', '◎'], ['add', 'Add', '+']].map(([id, label, icon]) => <button key={id} className={`nav-item ${view === id ? 'is-active' : ''}`} onClick={() => { if (id === 'add') setSelected(undefined); setView(id as View) }} aria-current={view === id ? 'page' : undefined}><span className={`nav-icon ${id === 'add' ? 'add-icon' : ''}`} aria-hidden="true">{icon}</span><span>{label}</span></button>)}</nav></div>
}
function EmptyState({ title, text, onAdd }: { title: string; text: string; onAdd?: () => void }) { return <section className="empty-state"><div className="empty-icon" aria-hidden="true">◎</div><h2>{title}</h2><p>{text}</p>{onAdd && <button className="button button-primary" onClick={onAdd}>Add your first contact <span aria-hidden="true">+</span></button>}</section> }
export default App
