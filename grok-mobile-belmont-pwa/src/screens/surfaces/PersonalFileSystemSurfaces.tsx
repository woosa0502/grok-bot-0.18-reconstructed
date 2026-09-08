import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Icon, type IconName } from "../../components/Icon";
import { InlineNotice, Section, SurfacePage } from "../../components/SurfacePrimitives";
import { EmptyState, ScreenError, ScreenSkeleton } from "../../components/ScreenState";
import type { FileSystemEntry, FileSystemListing, FileSystemPreview, FileSystemScope } from "../../types";
import type { SurfaceScreenProps } from "./types";

function fileSystemRouteValue(scope: FileSystemScope, path: string): string {
  return `${scope}:${path}`;
}

function parseFileSystemRouteValue(value: string | undefined): { scope: FileSystemScope; path: string } {
  const divider = value?.indexOf(":") ?? -1;
  const scope = divider >= 0 ? value?.slice(0, divider) : value;
  return {
    scope: scope === "windows" ? "windows" : "belmont",
    path: divider >= 0 ? value?.slice(divider + 1) ?? "" : "",
  };
}

function formatBytes(value: number | null | undefined): string {
  if (value == null) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatModified(value: number | null | undefined): string {
  if (value == null) return "";
  return new Intl.DateTimeFormat("ko", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function entryIcon(entry: FileSystemEntry): IconName {
  if (entry.type === "directory") return "folder";
  if (entry.type === "link") return "reply";
  if (entry.kind === "image") return "image";
  if (entry.kind === "archive") return "archive";
  return "file";
}

export function FileSystemScreen({ back, bot, open, route }: SurfaceScreenProps) {
  const { scope, path } = useMemo(() => parseFileSystemRouteValue(route.value), [route.value]);
  const [listing, setListing] = useState<FileSystemListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  async function load(offset = 0) {
    if (offset === 0) setLoading(true);
    else setLoadingMore(true);
    setError("");
    try {
      const next = await api.fileSystemList(scope, path, offset);
      setListing((current) => offset > 0 && current?.scope === next.scope && current.path === next.path ? { ...next, entries: [...current.entries, ...next.entries] } : next);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "파일 목록을 불러오지 못했습니다."); }
    finally { setLoading(false); setLoadingMore(false); }
  }

  useEffect(() => { setQuery(""); setListing(null); void load(); }, [scope, path]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? listing?.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(needle)) ?? [] : listing?.entries ?? [];
  }, [listing, query]);
  const label = scope === "windows" ? "Windows 전체" : "Belmont 폴더";

  function openEntry(entry: FileSystemEntry) {
    if (entry.type === "directory") open("FileSystemScreen", { botId: bot?.id, value: fileSystemRouteValue(scope, entry.path) });
    if (entry.type === "file") open("LocalFilePreviewScreen", { botId: bot?.id, value: fileSystemRouteValue(scope, entry.path) });
  }

  return (
    <SurfacePage back={back} subtitle={`${bot?.name ?? "내 Bot"} · 읽기 전용`} title={label}>
      <InlineNotice detail={scope === "windows" ? "이 Windows PC에 연결된 드라이브를 봅니다. 변경이나 삭제는 할 수 없습니다." : "이 프로젝트 폴더 안에서만 이동할 수 있습니다. 변경이나 삭제는 할 수 없습니다."} icon="account" title="내 전용 파일 보기" />
      {listing ? <div className="filesystem-location"><Icon name={scope === "windows" ? "display" : "folder"} size={16} /><span><small>현재 위치</small><strong>{listing.displayPath}</strong></span></div> : null}
      {listing && listing.entries.length > 12 ? <label className="search-field surface-search"><Icon name="search" size={17} /><input aria-label="현재 폴더 검색" onChange={(event) => setQuery(event.target.value)} placeholder="불러온 항목에서 찾기" value={query} /></label> : null}
      {loading ? <ScreenSkeleton rows={7} /> : null}
      {error ? <ScreenError message={error} retry={() => void load()} /> : null}
      {!loading && !error && listing ? (
        <Section detail={`${listing.totalEntries}개 항목`} title={path ? "폴더 내용" : scope === "windows" ? "연결된 드라이브" : "프로젝트 루트"}>
          {visible.map((entry) => {
            const disabled = entry.type === "link" || entry.type === "other";
            const detail = entry.type === "directory" ? "폴더" : entry.type === "link" ? "범위 밖으로 이어질 수 있어 열지 않음" : [formatBytes(entry.size), formatModified(entry.modifiedAt)].filter(Boolean).join(" · ");
            return <button className="filesystem-row" disabled={disabled} key={entry.path} onClick={() => openEntry(entry)} type="button"><span className="filesystem-icon"><Icon name={entryIcon(entry)} size={19} /></span><span><strong>{entry.name}</strong><small>{detail}</small></span>{disabled ? <small>링크</small> : <Icon name="chevronRight" size={14} />}</button>;
          })}
          {listing.nextOffset != null && !query ? <button className="filesystem-more" disabled={loadingMore} onClick={() => void load(listing.nextOffset ?? 0)} type="button">{loadingMore ? "불러오는 중" : `다음 ${Math.min(500, listing.totalEntries - listing.entries.length)}개 보기`}</button> : null}
        </Section>
      ) : null}
      {!loading && !error && listing && visible.length === 0 ? <EmptyState detail={query ? "현재 폴더에 일치하는 이름이 없습니다." : "이 폴더가 비어 있습니다."} title={query ? "검색 결과 없음" : "빈 폴더"} /> : null}
    </SurfacePage>
  );
}

export function LocalFilePreviewScreen({ back, bot, route }: SurfaceScreenProps) {
  const { scope, path } = useMemo(() => parseFileSystemRouteValue(route.value), [route.value]);
  const [preview, setPreview] = useState<FileSystemPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try { setPreview(await api.fileSystemPreview(scope, path)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "파일을 열지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [scope, path]);
  const contentUrl = preview?.contentUrl ?? api.fileSystemContentUrl(scope, path);
  const action = preview ? <a aria-label="새 창에서 열기" className="circle-button" href={contentUrl} rel="noreferrer" target="_blank"><Icon name="eye" size={18} /></a> : null;

  return (
    <SurfacePage action={action} back={back} subtitle={`${bot?.name ?? "내 Bot"} · 읽기 전용`} title={preview?.name ?? "파일 보기"}>
      {loading ? <ScreenSkeleton rows={5} /> : null}
      {error ? <ScreenError message={error} retry={() => void load()} /> : null}
      {preview ? <div className="filesystem-preview-meta"><span><small>위치</small><strong>{preview.displayPath}</strong></span><span><small>크기</small><strong>{formatBytes(preview.bytes)}</strong></span></div> : null}
      {preview?.kind === "text" ? <><pre className="local-file-text">{preview.text}</pre>{preview.truncated ? <InlineNotice detail="앞 1 MB만 표시했습니다. 우측 상단 열기 버튼으로 원본을 확인할 수 있습니다." title="긴 파일" /> : null}</> : null}
      {preview?.kind === "image" ? <img alt={preview.name} className="local-file-image" src={contentUrl} /> : null}
      {preview?.kind === "pdf" ? <iframe className="local-file-frame" src={contentUrl} title={preview.name} /> : null}
      {preview?.kind === "video" ? <video className="local-file-media" controls src={contentUrl} /> : null}
      {preview?.kind === "audio" ? <audio className="local-file-audio" controls src={contentUrl} /> : null}
      {preview?.kind === "binary" ? <div className="centered-hero compact-hero"><span className="hero-icon"><Icon name="file" size={28} /></span><h1>미리보기 없는 파일</h1><p>원본은 변경하지 않습니다. 아래 버튼으로 새 창에서 열거나 다운로드하세요.</p><a className="download-file" href={contentUrl} rel="noreferrer" target="_blank">파일 열기</a></div> : null}
    </SurfacePage>
  );
}
