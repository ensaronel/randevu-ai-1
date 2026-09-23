import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );
}

const BULLET_RE = /^[-*•]\s+/;
const NUMBER_RE = /^\d+[.)]\s+/;

/** Danışman yanıtları için küçük, güvenli (HTML basmayan) markdown gösterici: **kalın**, ## başlık, - madde, 1. numara. */
export default function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim());
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={`h${i}`} className="font-bold text-[14px] mt-1.5 first:mt-0">
          {renderInline(heading[1])}
        </p>
      );
      i++;
      continue;
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(lines[i].replace(BULLET_RE, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${i}`} className="list-disc pl-5 flex flex-col gap-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (NUMBER_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length && NUMBER_RE.test(lines[i])) {
        items.push(lines[i].replace(NUMBER_RE, ""));
        i++;
      }
      blocks.push(
        <ol key={`o${i}`} className="list-decimal pl-5 flex flex-col gap-1">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    blocks.push(<p key={`p${i}`}>{renderInline(line)}</p>);
    i++;
  }

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
