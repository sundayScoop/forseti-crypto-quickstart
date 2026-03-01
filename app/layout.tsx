import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/components/AuthProvider'

export const metadata: Metadata = {
    title: 'Forseti Crypto Quickstart',
    description: 'Demonstrates policy-enabled encryption and decryption using a Forseti contract with TideCloak',
}

interface RootLayoutProps {
    children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
    return (
        <html lang="en">
            <body style={{ margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
                <AuthProvider>
                    {children}
                </AuthProvider>
            </body>
        </html>
    )
}
