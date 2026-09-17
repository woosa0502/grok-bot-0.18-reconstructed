import { Fragment, type ReactNode } from "react";

const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/gu;

function inlineContent(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE_TOKEN).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/u.exec(part);
    if (link != null) return <a href={link[2]} key={key} rel="noreferrer" target="_blank">{link[1]}</a>;
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function paragraph(lines: string[], key: string) {
  return (
    <p key={key}>
      {lines.map((line, index) => <Fragment key={`${key}-${index}`}>{index > 0 ? <br /> : null}{inlineContent(line, `${key}-${index}`)}</Fragment>)}
    </p>
  );
}

export function MessageContent({ content }: { content: string }) {
  const lines = content.trim().split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]?.trimStart().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push(<pre key={`code-${index}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+)$/u.exec(line);
    if (heading != null) {
      const Tag: "h3" | "h4" = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(<Tag key={`heading-${index}`}>{inlineContent(heading[2] ?? "", `heading-${index}`)}</Tag>);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{inlineContent(item, `list-${index}-${itemIndex}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/u.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/u.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/u, ""));
        index += 1;
      }
      blocks.push(<ol key={`ordered-${index}`}>{items.map((item, itemIndex) => <li key={`${item}-${itemIndex}`}>{inlineContent(item, `ordered-${index}-${itemIndex}`)}</li>)}</ol>);
      continue;
    }
    // GFM table: a header row with "|" followed by a |---|---| delimiter row.
    const delimiter = lines[index + 1] ?? "";
    const isDelimiter = delimiter.trim().length > 0 && /^[|\s:-]+$/u.test(delimiter.trim()) && delimiter.includes("-") && delimiter.includes("|");
    if (line.includes("|") && isDelimiter) {
      const splitRow = (row: string): string[] => {
        let trimmed = row.trim();
        if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
        if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
        return trimmed.split("|").map((cell) => cell.trim());
      };
      const headerCells = splitRow(line);
      index += 2;
      const bodyRows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim().length > 0) {
        bodyRows.push(splitRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push(
        <div className="table-scroll" key={`table-${index}`}>
          <table className="rendered-table">
            <thead><tr>{headerCells.map((cell, cellIndex) => <th key={`th-${cellIndex}`}>{inlineContent(cell, `th-${index}-${cellIndex}`)}</th>)}</tr></thead>
            <tbody>{bodyRows.map((row, rowIndex) => <tr key={`tr-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`td-${rowIndex}-${cellIndex}`}>{inlineContent(cell, `td-${index}-${rowIndex}-${cellIndex}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length
      && (lines[index] ?? "").trim().length > 0
      && !/^\s*[-*]\s+/u.test(lines[index] ?? "")
      && !/^\s*\d+[.)]\s+/u.test(lines[index] ?? "")
      && !/^\s*#{1,6}\s+/u.test(lines[index] ?? "")
      && !(lines[index] ?? "").trimStart().startsWith("```")) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push(paragraph(paragraphLines, `paragraph-${index}`));
  }

  return <div className="message-content">{blocks}</div>;
}
