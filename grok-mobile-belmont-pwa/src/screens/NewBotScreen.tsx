import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { Icon } from "../components/Icon";
import type { BabyGrokColor, BabyGrokShape } from "../types";

const shapes: BabyGrokShape[] = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "hex", "gem", "cloud", "teardrop", "leaf"];
const colors: BabyGrokColor[] = ["violet", "blue", "green", "cyan", "orange", "magenta", "red", "yellow", "brown", "gray"];

export function NewBotScreen({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shape, setShape] = useState<BabyGrokShape>("blob");
  const [color, setColor] = useState<BabyGrokColor>("violet");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const previewName = useMemo(() => name.trim() || "New Bot", [name]);

  async function create() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.createBot({ name: name.trim(), description: description.trim(), shape, color });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bot을 만들지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="app-screen form-screen">
      <header className="sheet-toolbar"><button aria-label="닫기" className="circle-button" onClick={onClose} type="button"><Icon name="close" size={21} /></button><h1>새 Bot</h1><span /></header>
      <form className="bot-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <div className="bot-preview"><BabyGrokAvatar color={color} label={previewName} shape={shape} size={124} state="spawning" /><strong>{previewName}</strong><small>{description || "어떤 일을 맡길지 설명하세요."}</small></div>
        <label className="field-block"><span>이름</span><input autoFocus maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="예: Research Bot" value={name} /></label>
        <label className="field-block"><span>역할</span><textarea maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="이 Bot이 담당할 일을 적으세요." rows={3} value={description} /></label>
        <fieldset className="avatar-picker"><legend>모양</legend><div>{shapes.map((candidate) => <button aria-label={candidate} className={shape === candidate ? "selected" : ""} key={candidate} onClick={() => setShape(candidate)} type="button"><BabyGrokAvatar color={color} shape={candidate} size={45} /></button>)}</div></fieldset>
        <fieldset className="color-picker"><legend>색상</legend><div>{colors.map((candidate) => <button aria-label={candidate} className={color === candidate ? "selected" : ""} key={candidate} onClick={() => setColor(candidate)} style={{ "--swatch": candidate } as CSSProperties} type="button" />)}</div></fieldset>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="form-submit" disabled={!name.trim() || submitting} type="submit">{submitting ? "만드는 중" : "Bot 만들기"}</button>
      </form>
    </main>
  );
}
