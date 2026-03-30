'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.push('/dashboard')
    } else {
      setError('Mot de passe incorrect')
      setLoading(false)
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--neo-bg)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))' }}
          >
            <span className="text-white text-2xl font-bold tracking-tight">N</span>
          </motion.div>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--neo-text)' }}>
            NEO
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--neo-muted)' }}>
            Votre associé IA
          </p>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Mot de passe"
            autoFocus
            className="w-full px-4 py-3.5 rounded-xl text-base outline-none transition-all"
            style={{
              background:  'var(--neo-surface)',
              border:      '1px solid var(--neo-border-2)',
              color:       'var(--neo-text)',
            }}
            onFocus={e => (e.target as HTMLInputElement).style.borderColor = 'rgba(129,140,248,0.5)'}
            onBlur={e =>  (e.target as HTMLInputElement).style.borderColor = 'var(--neo-border-2)'}
          />

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-center"
              style={{ color: 'var(--neo-red)' }}
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3.5 rounded-xl font-medium text-base transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, var(--neo-accent), var(--neo-accent-2))',
              color: '#fff',
            }}
          >
            {loading ? 'Connexion…' : 'Continuer'}
          </button>
        </form>
      </motion.div>
    </main>
  )
}
