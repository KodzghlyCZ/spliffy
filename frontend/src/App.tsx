import { AuthBar } from './components/AuthBar'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Spliffy</h1>
        <AuthBar />
      </header>
      <main className="app-main" />
    </div>
  )
}

export default App
