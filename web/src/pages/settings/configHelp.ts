// 运行时配置项的 ParameterHelp 帮助内容生成（含 prompt 模板的占位符/系统提示说明）。
// 从 SettingsPage.tsx 抽出的纯逻辑。

import type { ParameterHelpContentOverride } from "../../components/ParameterHelp";
import type { TranslateFunction } from "../../lib/preferences";
import type { ConfigItem } from "../../lib/types";

const PROMPT_CONFIG_PLACEHOLDER_KEYS = new Set([
  "prompt_poster_image_template",
  "prompt_poster_image_edit_template",
  "prompt_image_chat_template",
]);

const PROMPT_CONFIG_SYSTEM_KEYS = new Set([
  "prompt_brief_system",
  "prompt_copy_system",
  "prompt_poster_image_reference_policy",
  "prompt_image_prompt_polish_system",
  "prompt_tail_split_system",
]);

function promptConfigHelpContent(item: ConfigItem, t: TranslateFunction): ParameterHelpContentOverride | null {
  if (item.key === "prompt_poster_image_template" || item.key === "prompt_poster_image_edit_template") {
    return {
      title: item.label,
      description: t("detail.parameterHelp.settingsPromptPosterTemplate.intro"),
      examples: [
        t("detail.parameterHelp.settingsPromptPlaceholder.inspirationName"),
        t("detail.parameterHelp.settingsPromptPlaceholder.category"),
        t("detail.parameterHelp.settingsPromptPlaceholder.price"),
        t("detail.parameterHelp.settingsPromptPlaceholder.sourceNote"),
        t("detail.parameterHelp.settingsPromptPlaceholder.instruction"),
        t("detail.parameterHelp.settingsPromptPlaceholder.size"),
        t("detail.parameterHelp.settingsPromptPlaceholder.contextBlock"),
        t("detail.parameterHelp.settingsPromptPlaceholder.referencePolicy"),
        t("detail.parameterHelp.settingsPromptPlaceholder.kind"),
        t("detail.parameterHelp.settingsPromptPlaceholder.kindLabel"),
        t("detail.parameterHelp.settingsPromptPlaceholder.kindRequirements"),
        t("detail.parameterHelp.settingsPromptPlaceholder.syntax"),
      ],
    };
  }
  if (item.key === "prompt_image_chat_template") {
    return {
      title: item.label,
      description: t("detail.parameterHelp.settingsPromptImageChatTemplate.intro"),
      examples: [
        t("detail.parameterHelp.settingsPromptPlaceholder.prompt"),
        t("detail.parameterHelp.settingsPromptPlaceholder.size"),
        t("detail.parameterHelp.settingsPromptPlaceholder.historyBlock"),
        t("detail.parameterHelp.settingsPromptPlaceholder.syntax"),
      ],
    };
  }
  if (PROMPT_CONFIG_SYSTEM_KEYS.has(item.key)) {
    return {
      title: item.label,
      description: item.description,
      examples: [
        t("detail.parameterHelp.settingsPromptSystem.noPlaceholders"),
        t("detail.parameterHelp.settingsPromptSystem.outputContract"),
        t("detail.parameterHelp.settingsRuntimeConfig.keyExample", { key: item.key }),
      ],
    };
  }
  if (PROMPT_CONFIG_PLACEHOLDER_KEYS.has(item.key)) {
    return null;
  }
  return null;
}

export function configItemHelpContent(item: ConfigItem, t: TranslateFunction): ParameterHelpContentOverride | null {
  const promptHelpContent = promptConfigHelpContent(item, t);
  if (promptHelpContent) {
    return promptHelpContent;
  }
  if (!item.description.trim()) {
    return null;
  }
  const examples = [t("detail.parameterHelp.settingsRuntimeConfig.keyExample", { key: item.key })];
  if (
    (item.minimum !== null && item.minimum !== undefined) ||
    (item.maximum !== null && item.maximum !== undefined)
  ) {
    examples.push(
      t("detail.parameterHelp.settingsRuntimeConfig.rangeExample", {
        min: item.minimum ?? "-",
        max: item.maximum ?? "-",
      }),
    );
  }
  examples.push(
    item.secret
      ? t("detail.parameterHelp.settingsRuntimeConfig.secretExample")
      : t("detail.parameterHelp.settingsRuntimeConfig.sourceExample"),
  );
  return {
    title: item.label,
    description: item.description,
    examples,
  };
}
