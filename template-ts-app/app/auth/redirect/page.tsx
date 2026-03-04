"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function RedirectPage() {
    const { isAuthenticated, isLoading } = useAuth();

    useEffect(() => {
        if (!isLoading) {
            if (isAuthenticated) {
                window.location.href = "/home";
            } else {
                window.location.href = "/";
            }
        }
    }, [isLoading, isAuthenticated]);

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1rem',
            color: '#555',
        }}>
            <p>Waiting for authentication...</p>
        </div>
    );
}
