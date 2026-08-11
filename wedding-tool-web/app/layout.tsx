import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sitzordnung",
  description: "Sitzplan-Tool (Next.js + Supabase)"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
