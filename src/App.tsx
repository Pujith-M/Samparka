const people = [
  {
    initials: 'AM',
    name: 'A little more present',
    detail: 'Make space for the people you love.',
    color: 'peach',
  },
  {
    initials: '♡',
    name: 'Your people, in one place',
    detail: 'A calmer way to keep everyone close.',
    color: 'lavender',
  },
  {
    initials: '✳',
    name: 'Made for meaningful moments',
    detail: 'Thoughtful connections start here.',
    color: 'sage',
  },
]

function App() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Samparka home">
          <span className="brand-mark" aria-hidden="true">
            s
          </span>
          <span>samparka</span>
        </a>
        <span className="top-note">
          <span className="status-dot" /> A little more connected
        </span>
      </header>

      <section className="hero" id="home" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">A softer way to stay close</p>
          <h1 id="hero-title">
            Good things grow
            <br />
            when we <em>keep in touch.</em>
          </h1>
          <p className="hero-description">
            Life gets busy. Samparka helps you hold on to the little details and
            make more room for the people who matter.
          </p>
          <a className="primary-action" href="mailto:hello@samparka.app">
            Something lovely is on its way <span aria-hidden="true">↗</span>
          </a>
          <p className="quiet-note">A thoughtful little space, coming soon.</p>
        </div>

        <div className="visual" aria-label="Illustration of a note and flowers">
          <div className="sun-wash" />
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="flower flower-one">
            <i />
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="flower flower-two">
            <i />
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="stem stem-one" />
          <div className="stem stem-two" />
          <div className="leaf leaf-one" />
          <div className="leaf leaf-two" />
          <div className="leaf leaf-three" />
          <div className="note-card">
            <div className="note-top">
              <span className="mini-mark">s</span>
              <span>JUST A NOTE</span>
            </div>
            <p>
              Thinking of
              <br />
              you today.
            </p>
            <div className="note-heart">♡</div>
            <span className="note-line" />
          </div>
          <div className="sparkle sparkle-a">✳</div>
          <div className="sparkle sparkle-b">✦</div>
        </div>
      </section>

      <section className="pillars" aria-label="What Samparka is about">
        {people.map((item) => (
          <article className="pillar" key={item.name}>
            <div className={`pillar-icon ${item.color}`} aria-hidden="true">
              {item.initials}
            </div>
            <div>
              <h2>{item.name}</h2>
              <p>{item.detail}</p>
            </div>
          </article>
        ))}
      </section>

      <footer className="footer">
        <span>Made with care, for the people you care about.</span>
        <span>
          Samparka <span aria-hidden="true">·</span> 2026
        </span>
      </footer>
    </main>
  )
}

export default App
