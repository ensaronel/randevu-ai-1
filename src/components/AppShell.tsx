"use client";

import type { ReactNode } from "react";
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
