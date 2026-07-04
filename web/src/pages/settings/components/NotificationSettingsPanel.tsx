// 通知设置面板：通知自动关闭时长，写入本地偏好。

import { useState } from "react";

import { Save } from "lucide-react";

import { ClassicTextInput } from "../../../components/classicInputs";
import { WorkspaceTextInput } from "../../../components/workspaceInputs";
import { useI18n } from "../../../lib/preferences";
import {
  DEFAULT_NOTIFICATION_AUTO_CLOSE_MS,
  MAX_NOTIFICATION_AUTO_CLOSE_MS,
  MIN_NOTIFICATION_AUTO_CLOSE_MS,
  readNotificationAutoCloseMs,
  writeNotificationAutoCloseMs,
} from "../../../lib/notifications";
import { SettingsFormField } from "./SettingsFormField";
import { PANEL_CLASS, useSettingsActionClassNames } from "./styles";

export function NotificationSettingsPanel({
  onSaved,
  workspaceSubpage = false,
}: {
  onSaved: () => void;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const { SETTINGS_MAIN_ACTION_CLASS } = useSettingsActionClassNames();
  const [notificationAutoCloseMs, setNotificationAutoCloseMs] = useState(readNotificationAutoCloseMs);
  const saveNotificationSettings = () => {
    writeNotificationAutoCloseMs(notificationAutoCloseMs);
    setNotificationAutoCloseMs(readNotificationAutoCloseMs());
    onSaved();
  };

  return (
    <section className={`${PANEL_CLASS} space-y-5`}>
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          {t("settings.notification.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("settings.notification.description")}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsFormField label={t("settings.notification.autoCloseMs")}>
          {workspaceSubpage ? (
            <WorkspaceTextInput
              type="number"
              min={MIN_NOTIFICATION_AUTO_CLOSE_MS}
              max={MAX_NOTIFICATION_AUTO_CLOSE_MS}
              step={500}
              value={notificationAutoCloseMs}
              onChange={(event) => {
                const nextValue = Number(event.target.value || DEFAULT_NOTIFICATION_AUTO_CLOSE_MS);
                setNotificationAutoCloseMs(nextValue);
              }}
              size="default"
            />
          ) : (
            <ClassicTextInput
              type="number"
              min={MIN_NOTIFICATION_AUTO_CLOSE_MS}
              max={MAX_NOTIFICATION_AUTO_CLOSE_MS}
              step={500}
              value={notificationAutoCloseMs}
              onChange={(event) => {
                const nextValue = Number(event.target.value || DEFAULT_NOTIFICATION_AUTO_CLOSE_MS);
                setNotificationAutoCloseMs(nextValue);
              }}
              size="default"
            />
          )}
        </SettingsFormField>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={saveNotificationSettings} className={SETTINGS_MAIN_ACTION_CLASS}>
          <Save size={14} className="mr-1.5" />
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}
