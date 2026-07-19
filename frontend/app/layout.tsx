import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "splat-service",
  description: "Turn photos into a 3D Gaussian splat",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Small top nav shown on every page. */}
        <nav className="flex items-center gap-6 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <Link href="/" className="font-semibold">
            splat-service
          </Link>
          <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <Link href="/" className="hover:text-black dark:hover:text-white">
              Upload
            </Link>
            <Link
              href="/jobs"
              className="hover:text-black dark:hover:text-white"
            >
              Jobs
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
