import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AuthProvider } from '@/components/AuthProvider'
import './globals.css'

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
            <body>
                <AuthProvider>
                    {children}
                </AuthProvider>
            </body>
        </html>
    )
}
