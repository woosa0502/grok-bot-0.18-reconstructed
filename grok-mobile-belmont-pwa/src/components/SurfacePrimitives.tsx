import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function SurfacePage({
  title,
  subtitle,
  back,
  action,
  children,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  back: () => void;
  action?: ReactNode;
  children: ReactNode;
  tone?: "default" | "computer";
}) {
  return (
    <main className={`app-screen surface-page ${tone === "computer" ? "surface-page-computer" : ""}`}>
      <header className="sheet-toolbar surface-toolbar">
        <button aria-label="뒤로" className={tone === "computer" ? "dark-circle" : "circle-button"} onClick={back} type="button"><Icon name="back" size={21} /></button>
        <span className="surface-title"><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}</span>
        <span className="surface-action">{action}</span>
      </header>
      <div className="surface-body">{children}</div>
    </main>
  );
}

export function Section({ title, detail, children }: { title?: string; detail?: string; children: ReactNode }) {
  return (
    <section className="surface-section">
      {title ? <header><h2>{title}</h2>{detail ? <p>{detail}</p> : null}</header> : null}
      <div className="surface-section-content">{children}</div>
    </section>
  );
}

export function NavRow({
  icon,
  title,
  detail,
  meta,
  onClick,
  destructive = false,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  meta?: ReactNode;
  onClick?: () => void;
  destructive?: boolean;
}) {
  const content = (
    <>
      <span className="settings-symbol"><Icon name={icon} size={18} /></span>
      <span className="surface-row-copy"><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>
      <span className="surface-row-meta">{meta ?? (onClick ? <Icon name="chevronRight" size={14} /> : null)}</span>
    </>
  );
  if (onClick) return <button className={`surface-row ${destructive ? "destructive" : ""}`} onClick={onClick} type="button">{content}</button>;
  return <div className={`surface-row ${destructive ? "destructive" : ""}`}>{content}</div>;
}

export function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <button aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} role="switch" type="button"><i /></button>;
}

export function ChoiceChips({ values, selected, onChange }: { values: string[]; selected: string; onChange: (value: string) => void }) {
  return <div className="choice-chips">{values.map((value) => <button aria-pressed={selected === value} className={selected === value ? "selected" : ""} key={value} onClick={() => onChange(value)} type="button">{value}</button>)}</div>;
}

export function PrimaryButton({ children, onClick, disabled = false }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return <button className="surface-primary" disabled={disabled} onClick={onClick} type="button">{children}</button>;
}

export function InlineNotice({ title, detail, icon = "warning" }: { title: string; detail: string; icon?: IconName }) {
  return <div className="inline-notice"><Icon name={icon} size={19} /><span><strong>{title}</strong><small>{detail}</small></span></div>;
}

export function TextField({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean }) {
  return <label className="field-block"><span>{label}</span>{multiline ? <textarea onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={4} value={value} /> : <input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />}</label>;
}
