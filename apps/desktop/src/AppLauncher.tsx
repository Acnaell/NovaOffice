// Menu de aplicativos do NovaOffice (botão de grade na barra de título): os
// oito aplicativos da suíte, com o atual em destaque. Os que ainda não
// existem aparecem como "Em breve".

import { useRef, useState } from "react";
import { keepFocus, Popover } from "./controls";
import { useI18n, type MessageKey } from "./i18n";
import { BrandMark, icons, type BrandApp } from "./icons";

export interface AppInfo {
  id: BrandApp;
  name: string;
  subtitle: MessageKey;
  ready: boolean;
}

export const APPS: AppInfo[] = [
  { id: "text", name: "Nova Text", subtitle: "apps.text", ready: true },
  { id: "sheets", name: "Nova Sheets", subtitle: "apps.sheets", ready: false },
  { id: "slides", name: "Nova Slides", subtitle: "apps.slides", ready: false },
  { id: "draw", name: "Nova Draw", subtitle: "apps.draw", ready: false },
  { id: "base", name: "Nova Base", subtitle: "apps.base", ready: false },
  { id: "math", name: "Nova Math", subtitle: "apps.math", ready: false },
  { id: "mail", name: "Nova Mail", subtitle: "apps.mail", ready: false },
  { id: "drive", name: "Nova Drive", subtitle: "apps.drive", ready: false },
];

export function AppLauncher({ current, onHome }: { current: BrandApp; onHome: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        className="launcher-button"
        aria-label={t("apps.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("apps.title")}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {icons.grid}
      </button>
      <Popover anchor={button.current} open={open} onClose={() => setOpen(false)} className="launcher">
        <div className="launcher-head">
          <span>{t("apps.title")}</span>
          <span className="launcher-hint">{t("apps.escToClose")}</span>
        </div>
        <div className="launcher-grid">
          {APPS.map((app) => (
            <button
              key={app.id}
              className="launcher-app"
              aria-current={app.id === current ? "true" : undefined}
              disabled={!app.ready}
              title={app.ready ? app.name : `${app.name} — ${t("apps.soon")}`}
              onClick={() => setOpen(false)}
            >
              <span className="launcher-icon">
                <BrandMark app={app.id} size={44} />
              </span>
              <span className="launcher-name">{app.name}</span>
              <span className="launcher-sub">{app.ready ? t(app.subtitle) : t("apps.soon")}</span>
            </button>
          ))}
        </div>
        <button
          className="launcher-home"
          onClick={() => {
            setOpen(false);
            onHome();
          }}
        >
          <BrandMark size={18} />
          {t("apps.home")}
        </button>
      </Popover>
    </>
  );
}
