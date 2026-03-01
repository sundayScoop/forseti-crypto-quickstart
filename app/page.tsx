'use client'

import { useCallback, useEffect, type CSSProperties } from 'react'
import { IAMService } from '@tidecloak/js'
import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'

const containerStyle: CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f5f5',
    margin: 0,
}

const cardStyle: CSSProperties = {
    background: '#fff',
    padding: '2rem',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    textAlign: 'center',
    maxWidth: '420px',
    width: '100%',
}

const buttonStyle: CSSProperties = {
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    borderRadius: '4px',
    border: 'none',
    background: '#0070f3',
    color: '#fff',
    cursor: 'pointer',
}

export default function LoginPage() {
    const { isAuthenticated, isLoading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (isAuthenticated) {
            router.push('/home')
        }
    }, [isAuthenticated, router])

    const onLogin = useCallback(() => {
        IAMService.doLogin();
    }, [])

    if (isLoading) {
        return (
            <div style={containerStyle}>
                <p style={{ color: '#555' }}>Loading...</p>
            </div>
        )
    }

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <h1 style={{ margin: 0, fontSize: '1.75rem' }}>Forseti Crypto Quickstart</h1>
                <p style={{ color: '#555', marginTop: '0.5rem' }}>
                    Demonstrates policy-enabled encryption and decryption using a Forseti contract with TideCloak.
                </p>
                <button onClick={onLogin} style={buttonStyle}>
                    Log In
                </button>
            </div>
        </div>
    )
}
