import type { ReactNode } from "react";
import Mascot from "@/components/Mascot";

/**
 * Liste/veri bulunmayan yerlerde duz gri yazi yerine maskotlu, sicak bir
 * bos-durum mesaji — marka karakterini Dashboard disina da tasir.
 */
export default function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center gap-2.5 py-8 px-4">
      <Mascot size={56} />
      <p className="text-[13.5px] text-ink-muted max-w-[260px] leading-relaxed">{message}</p>
      {action}
    </div>
  );
}
