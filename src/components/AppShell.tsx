"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";

export default function AppShell({
  businessName = "Randevu AI",
  children,
}: {
  businessName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar businessName={businessName} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobilde alt menüden çıkarılan "Ayarlar" buraya taşındı — bottom nav'da
            4 gerçek sekme (2 sol + 2 sağ) kalıp ortadaki + butonu görünmez bir
            dolgu olmadan gerçekten simetrik olsun diye. */}
        <div className="lg:hidden flex justify-end px-4 pt-3">
          <Link
            href="/ayarlar"
            aria-label="Ayarlar"
            className="w-9 h-9 rounded-full bg-surface border border-border flex items-center justify-center text-ink-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.5-2.4.6a7.6 7.6 0 00-1.7-1L15 3h-6l-.3 2.6a7.6 7.6 0 00-1.7 1l-2.4-.6-2 3.5L4.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.5 2.4-.6a7.6 7.6 0 001.7 1L9 21h6l.3-2.6a7.6 7.6 0 001.7-1l2.4.6 2-3.5-2-1.5z" />
            </svg>
          </Link>
        </div>
        <main className="flex-1 px-4 py-5 lg:px-10 lg:py-8 flex flex-col gap-5 max-w-md lg:max-w-5xl mx-auto w-full">
          {children}
        </main>
        <div className="lg:hidden">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}
