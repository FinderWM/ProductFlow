import { describe, expect, it } from "vitest";

import { translate } from "../lib/i18n";
import { uiLayoutSchemeSelectOptions } from "./UiLayoutSchemeSettingsControl";

describe("UiLayoutSchemeSettingsControl helpers", () => {
  it("builds localized layout scheme options in display order", () => {
    expect(uiLayoutSchemeSelectOptions((key) => translate("zh-CN", key))).toEqual([
      { value: "classic", label: "经典" },
      { value: "workspace", label: "工作台" },
    ]);
    expect(uiLayoutSchemeSelectOptions((key) => translate("en-US", key))).toEqual([
      { value: "classic", label: "Classic" },
      { value: "workspace", label: "Workspace" },
    ]);
  });
});
