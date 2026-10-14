import { useState } from 'react'

type View = 'recent' | 'contacts' | 'add'

const navigation = [
  { id: 'recent' as const, label: 'Recent', icon: '◷' },
  { id: 'contacts' as const, label: 'Contacts', icon: '◎' },
  { id: 'add' as const, label: 'Add', icon: '+' },
]

function EmptyState({ view, onAdd }: { view: 'recent' | 'contacts'; onAdd: () => void }) {
  const isRecent = view === 'recent'

  return (
    <section className="empty-state" aria-labelledby={`${view}-empty-title`}>
      <div className="empty-icon" aria-hidden="true">{isRecent ? '◷' : '◎'}</div>
      <h2 id={`${view}-empty-title`}>{isRecent ? 'Nothing recent yet' : 'Your circle starts here'}</h2>
      <p>
        {isRecent
          ? 'New and updated contacts will appear here.'
          : 'Add the people who matter to you. Your contacts stay stored on this device.'}
      </p>
      {!isRecent && <button className="button button-primary" onClick={onAdd}>Add your first contact <span aria-hidden="true">+</span></button>}
    </section>
  )
}

function AddContact({ onBack }: { onBack: () => void }) {
  return (
    <section className="form-view" aria-labelledby="add-title">
      <button className="back-button" onClick={onBack} aria-label="Back to contacts">← <span>Contacts</span></button>
      <div className="view-heading form-heading">
        <div>
          <p className="eyebrow">New connection</p>
          <h1 id="add-title">Add contact</h1>
        </div>
      </div>
      <form className="contact-form" onSubmit={(event) => event.preventDefault()}>
        <label>
          Name
          <input type="text" placeholder="Full name" />
        </label>
        <label>
          Phone number
          <input type="tel" placeholder="Phone number" />
        </label>
        <label>
          Email <span className="optional">Optional</span>
          <input type="email" placeholder="Email address" />
        </label>
        <p className="form-note">This is a preview of the contact form. Saving contacts will be available soon.</p>
        <button className="button button-primary" type="submit" disabled>Save contact</button>
      </form>
    </section>
  )
}

function App() {
  const [view, setView] = useState<View>('contacts')
  const pageTitle = view === 'recent' ? 'Recent' : 'Contacts'

  const selectView = (nextView: View) => setView(nextView)

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="#contacts" onClick={() => selectView('contacts')} aria-label="Samparka contacts">
          <span className="brand-mark" aria-hidden="true">s</span>
          <span>samparka</span>
        </a>
        <button className="icon-button" aria-label="More options">•••</button>
      </header>

      <main className="main-content">
        {view === 'add' ? <AddContact onBack={() => selectView('contacts')} /> : (
          <>
            <div className="view-heading">
              <div>
                <p className="eyebrow">Your people</p>
                <h1>{pageTitle}</h1>
              </div>
              {view === 'contacts' && <button className="search-button" aria-label="Search contacts">⌕ <span>Search</span></button>}
            </div>
            <EmptyState view={view} onAdd={() => selectView('add')} />
          </>
        )}
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <button key={item.id} className={`nav-item ${view === item.id ? 'is-active' : ''}`} onClick={() => selectView(item.id)} aria-current={view === item.id ? 'page' : undefined}>
            <span className={`nav-icon ${item.id === 'add' ? 'add-icon' : ''}`} aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App
