import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppNameProvider } from './context/AppNameContext'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import './i18n'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AppNameProvider>
          <App />
        </AppNameProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
