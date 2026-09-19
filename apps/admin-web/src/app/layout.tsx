import type { Metadata } from "next";
import "./globals.css";
import { AdminAuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";

export const metadata: Metadata = {
  title: "emrtd-verify — Administration",
  description: "Interface d'administration interne de la plateforme emrtd-verify.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen font-sans antialiased">
        <QueryProvider>
          <AdminAuthProvider>{children}</AdminAuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
