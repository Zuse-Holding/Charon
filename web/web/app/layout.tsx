import type { Metadata } from "next";
import "./globals.css";
import CharonResearch from "../components/CharonResearch";

export const metadata: Metadata = {
  title: "CHARON · Powered by Selene",
  description: "AI Business Intelligence · Zuse Holdings",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500&family=JetBrains+Mono:wght@400;500&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <CharonResearch />
      </body>
    </html>
  );
}
