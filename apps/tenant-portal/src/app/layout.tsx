import type { Metadata } from "next";
import "./globals.css";
import { TenantAuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";

export const metadata: Metadata = {
  title: "emrtd-verify — Portail tenant",
  description: "Suivi des vérifications et des clients pour les intégrateurs emrtd-verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>
          <TenantAuthProvider>{children}</TenantAuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
