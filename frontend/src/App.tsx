import { AuthBar } from './components/AuthBar'
import { Chat } from './components/Chat'
import { LanguageToggle } from './components/LanguageToggle'
import { ThemeToggle } from './components/ThemeToggle'
import { useAppName } from './context/AppNameContext'
import './App.css'

function App() {
  const { name, initial } = useAppName()

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo" aria-hidden="true">
            {initial}
          </span>
          <h1>{name}</h1>
        </div>
        <div className="app-header-actions">
          <LanguageToggle />
          <ThemeToggle />
          <AuthBar />
        </div>
      </header>
      <main className="app-main">
        <Chat />
      </main>
    </div>
  )
}

export default App
