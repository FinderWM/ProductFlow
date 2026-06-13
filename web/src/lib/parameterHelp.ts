import type { TranslationKey } from "./i18n";

export type ParameterHelpUiType = "default" | "inspirationDetail" | "settings" | "imageChat" | "create";

export interface ParameterHelpUiClassNames {
  button: string;
  overlay: string;
  panel: string;
  header: string;
  icon: string;
  eyebrow: string;
  title: string;
  closeButton: string;
  body: string;
  sectionTitle: string;
  intro: string;
  example: string;
}

export type StaticParameterHelpKey =
  | "inspirationContextLongText"
  | "inspirationContextDocument"
  | "inspirationContextDynamicFields"
  | "referenceRole"
  | "copyInstruction"
  | "copyTextGenerationConfig"
  | "copyTone"
  | "copyChannel"
  | "copyVisualGuidance"
  | "copyVisualExpression"
  | "tailSourceText"
  | "tailDescription"
  | "tailMaxItems"
  | "imageDescription"
  | "imageGenerationConfig"
  | "imageGenerationCount"
  | "imageToolOptions"
  | "imageToolModel"
  | "imageToolQuality"
  | "imageToolFormat"
  | "imageToolCompression"
  | "imageToolBackground"
  | "imageToolModeration"
  | "imageToolAction"
  | "imageToolInputFidelity"
  | "imageToolPartialImages"
  | "imageChatPrompt"
  | "imageChatPromptPolishConfig"
  | "imageSessionReferences"
  | "settingsProviderType"
  | "settingsProviderBaseUrl"
  | "settingsProviderCapabilities"
  | "settingsProviderEnabled"
  | "settingsProviderApiInterface"
  | "settingsProviderProfile"
  | "settingsTextBriefModel"
  | "settingsTextCopyModel"
  | "settingsImageModel"
  | "settingsGenerationPriority"
  | "settingsGenerationMaxConcurrency"
  | "settingsGenerationAvailabilityWindow"
  | "settingsGenerationFailureThreshold"
  | "settingsGenerationCooldownMinutes"
  | "settingsResponsesBackground"
  | "settingsGeminiApiVersion"
  | "settingsGeminiOutputMimeType"
  | "settingsImagesQuality"
  | "settingsImagesStyle";

export type ParameterHelpKey = StaticParameterHelpKey | `settings.config.${string}`;

export interface StaticParameterHelpContent {
  titleKey: TranslationKey;
  introKey: TranslationKey;
  examplesKey: TranslationKey;
}

export interface ParameterHelpRegistryEntry extends StaticParameterHelpContent {
  uiClassNames?: Partial<Record<ParameterHelpUiType, Partial<ParameterHelpUiClassNames>>>;
}

export const PARAMETER_HELP_BASE_UI_CLASS_NAMES: ParameterHelpUiClassNames = {
  button:
    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500 dark:hover:bg-violet-500/12 dark:hover:text-violet-200 dark:focus-visible:ring-violet-400",
  overlay: "fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm",
  panel:
    "max-h-[min(760px,calc(100dvh-3rem))] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0b1220] dark:shadow-black/45",
  header: "flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800",
  icon:
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-violet-400/30 dark:bg-violet-500/12 dark:text-violet-100",
  eyebrow: "text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500",
  title: "mt-1 text-lg font-semibold text-slate-950 dark:text-white",
  closeButton:
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-violet-400/50 dark:hover:text-white",
  body: "max-h-[calc(min(760px,100dvh-3rem)-5.25rem)] overflow-y-auto px-5 py-5",
  sectionTitle: "text-sm font-semibold text-slate-900 dark:text-slate-100",
  intro: "mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300",
  example:
    "rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-300",
};

export const PARAMETER_HELP_UI_CLASS_REGISTRY: Record<ParameterHelpUiType, Partial<ParameterHelpUiClassNames>> = {
  default: {},
  inspirationDetail: {},
  create: {
    button:
      "text-zinc-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:ring-blue-500 dark:text-slate-500 dark:hover:bg-violet-500/12 dark:hover:text-violet-200",
    icon:
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700 dark:border-violet-400/30 dark:bg-violet-500/12 dark:text-violet-100",
  },
  settings: {
    button:
      "pf-settings-help-button bg-transparent p-0 hover:bg-transparent hover:text-indigo-600 focus-visible:bg-transparent dark:hover:bg-transparent dark:hover:text-violet-200",
    overlay: "fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm",
    panel:
      "max-h-[min(760px,calc(100dvh-3rem))] w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/18 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45",
    icon:
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-indigo-700 dark:border-slate-700 dark:bg-[#111b2d] dark:text-violet-100",
  },
  imageChat: {
    panel:
      "max-h-[min(760px,calc(100dvh-3rem))] w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45",
    icon:
      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-violet-700 dark:border-violet-400/35 dark:bg-violet-500/14 dark:text-violet-100",
  },
};

export const PARAMETER_HELP_REGISTRY: Record<StaticParameterHelpKey, ParameterHelpRegistryEntry> = {
  inspirationContextLongText: {
    titleKey: "detail.inspector.longText",
    introKey: "detail.parameterHelp.inspirationContextLongText.intro",
    examplesKey: "detail.parameterHelp.inspirationContextLongText.examples",
  },
  inspirationContextDocument: {
    titleKey: "detail.inspector.contextDocument",
    introKey: "detail.parameterHelp.inspirationContextDocument.intro",
    examplesKey: "detail.parameterHelp.inspirationContextDocument.examples",
  },
  inspirationContextDynamicFields: {
    titleKey: "detail.inspector.dynamicFields",
    introKey: "detail.parameterHelp.inspirationContextDynamicFields.intro",
    examplesKey: "detail.parameterHelp.inspirationContextDynamicFields.examples",
  },
  referenceRole: {
    titleKey: "detail.inspector.role",
    introKey: "detail.parameterHelp.referenceRole.intro",
    examplesKey: "detail.parameterHelp.referenceRole.examples",
  },
  copyInstruction: {
    titleKey: "detail.inspector.copyInstruction",
    introKey: "detail.parameterHelp.copyInstruction.intro",
    examplesKey: "detail.parameterHelp.copyInstruction.examples",
  },
  copyTextGenerationConfig: {
    titleKey: "detail.inspector.textGenerationConfig",
    introKey: "detail.parameterHelp.textGenerationConfig.intro",
    examplesKey: "detail.parameterHelp.textGenerationConfig.examples",
  },
  copyTone: {
    titleKey: "detail.inspector.tone",
    introKey: "detail.parameterHelp.copyTone.intro",
    examplesKey: "detail.parameterHelp.copyTone.examples",
  },
  copyChannel: {
    titleKey: "detail.inspector.channel",
    introKey: "detail.parameterHelp.copyChannel.intro",
    examplesKey: "detail.parameterHelp.copyChannel.examples",
  },
  copyVisualGuidance: {
    titleKey: "detail.inspector.visualGuidance",
    introKey: "detail.parameterHelp.copyVisualGuidance.intro",
    examplesKey: "detail.parameterHelp.copyVisualGuidance.examples",
  },
  copyVisualExpression: {
    titleKey: "detail.inspector.visualExpression",
    introKey: "detail.parameterHelp.copyVisualExpression.intro",
    examplesKey: "detail.parameterHelp.copyVisualExpression.examples",
  },
  tailSourceText: {
    titleKey: "detail.inspector.tailSourceText",
    introKey: "detail.parameterHelp.tailSourceText.intro",
    examplesKey: "detail.parameterHelp.tailSourceText.examples",
  },
  tailDescription: {
    titleKey: "detail.inspector.tailDescription",
    introKey: "detail.parameterHelp.tailDescription.intro",
    examplesKey: "detail.parameterHelp.tailDescription.examples",
  },
  tailMaxItems: {
    titleKey: "detail.inspector.tailMaxItems",
    introKey: "detail.parameterHelp.tailMaxItems.intro",
    examplesKey: "detail.parameterHelp.tailMaxItems.examples",
  },
  imageDescription: {
    titleKey: "detail.inspector.imageDescription",
    introKey: "detail.parameterHelp.imageDescription.intro",
    examplesKey: "detail.parameterHelp.imageDescription.examples",
  },
  imageGenerationConfig: {
    titleKey: "detail.inspector.imageGenerationConfig",
    introKey: "detail.parameterHelp.imageGenerationConfig.intro",
    examplesKey: "detail.parameterHelp.imageGenerationConfig.examples",
  },
  imageGenerationCount: {
    titleKey: "imageSettings.count",
    introKey: "detail.parameterHelp.imageGenerationCount.intro",
    examplesKey: "detail.parameterHelp.imageGenerationCount.examples",
  },
  imageToolOptions: {
    titleKey: "detail.inspector.imageToolOptions",
    introKey: "detail.parameterHelp.imageToolOptions.intro",
    examplesKey: "detail.parameterHelp.imageToolOptions.examples",
  },
  imageToolModel: {
    titleKey: "imageTool.tool",
    introKey: "detail.parameterHelp.imageToolModel.intro",
    examplesKey: "detail.parameterHelp.imageToolModel.examples",
  },
  imageToolQuality: {
    titleKey: "imageTool.quality",
    introKey: "detail.parameterHelp.imageToolQuality.intro",
    examplesKey: "detail.parameterHelp.imageToolQuality.examples",
  },
  imageToolFormat: {
    titleKey: "imageTool.format",
    introKey: "detail.parameterHelp.imageToolFormat.intro",
    examplesKey: "detail.parameterHelp.imageToolFormat.examples",
  },
  imageToolCompression: {
    titleKey: "imageTool.compression",
    introKey: "detail.parameterHelp.imageToolCompression.intro",
    examplesKey: "detail.parameterHelp.imageToolCompression.examples",
  },
  imageToolBackground: {
    titleKey: "imageTool.background",
    introKey: "detail.parameterHelp.imageToolBackground.intro",
    examplesKey: "detail.parameterHelp.imageToolBackground.examples",
  },
  imageToolModeration: {
    titleKey: "imageTool.moderation",
    introKey: "detail.parameterHelp.imageToolModeration.intro",
    examplesKey: "detail.parameterHelp.imageToolModeration.examples",
  },
  imageToolAction: {
    titleKey: "imageTool.action",
    introKey: "detail.parameterHelp.imageToolAction.intro",
    examplesKey: "detail.parameterHelp.imageToolAction.examples",
  },
  imageToolInputFidelity: {
    titleKey: "imageTool.inputFidelity",
    introKey: "detail.parameterHelp.imageToolInputFidelity.intro",
    examplesKey: "detail.parameterHelp.imageToolInputFidelity.examples",
  },
  imageToolPartialImages: {
    titleKey: "imageTool.partialImages",
    introKey: "detail.parameterHelp.imageToolPartialImages.intro",
    examplesKey: "detail.parameterHelp.imageToolPartialImages.examples",
  },
  imageChatPrompt: {
    titleKey: "chat.prompt",
    introKey: "detail.parameterHelp.imageChatPrompt.intro",
    examplesKey: "detail.parameterHelp.imageChatPrompt.examples",
  },
  imageChatPromptPolishConfig: {
    titleKey: "chat.promptPolishConfig",
    introKey: "detail.parameterHelp.imageChatPromptPolishConfig.intro",
    examplesKey: "detail.parameterHelp.imageChatPromptPolishConfig.examples",
  },
  imageSessionReferences: {
    titleKey: "chat.sessionReferences",
    introKey: "detail.parameterHelp.imageSessionReferences.intro",
    examplesKey: "detail.parameterHelp.imageSessionReferences.examples",
  },
  settingsProviderType: {
    titleKey: "settings.provider.typeLabel",
    introKey: "detail.parameterHelp.settingsProviderType.intro",
    examplesKey: "detail.parameterHelp.settingsProviderType.examples",
  },
  settingsProviderBaseUrl: {
    titleKey: "settings.provider.baseUrlLabel",
    introKey: "detail.parameterHelp.settingsProviderBaseUrl.intro",
    examplesKey: "detail.parameterHelp.settingsProviderBaseUrl.examples",
  },
  settingsProviderCapabilities: {
    titleKey: "settings.provider.capabilitiesLabel",
    introKey: "detail.parameterHelp.settingsProviderCapabilities.intro",
    examplesKey: "detail.parameterHelp.settingsProviderCapabilities.examples",
  },
  settingsProviderEnabled: {
    titleKey: "settings.provider.enabledSwitchLabel",
    introKey: "detail.parameterHelp.settingsProviderEnabled.intro",
    examplesKey: "detail.parameterHelp.settingsProviderEnabled.examples",
  },
  settingsProviderApiInterface: {
    titleKey: "settings.provider.apiInterfaceLabel",
    introKey: "detail.parameterHelp.settingsProviderApiInterface.intro",
    examplesKey: "detail.parameterHelp.settingsProviderApiInterface.examples",
  },
  settingsProviderProfile: {
    titleKey: "settings.provider.providerProfileLabel",
    introKey: "detail.parameterHelp.settingsProviderProfile.intro",
    examplesKey: "detail.parameterHelp.settingsProviderProfile.examples",
  },
  settingsTextBriefModel: {
    titleKey: "settings.provider.textBriefModelLabel",
    introKey: "detail.parameterHelp.settingsTextBriefModel.intro",
    examplesKey: "detail.parameterHelp.settingsTextBriefModel.examples",
  },
  settingsTextCopyModel: {
    titleKey: "settings.provider.textCopyModelLabel",
    introKey: "detail.parameterHelp.settingsTextCopyModel.intro",
    examplesKey: "detail.parameterHelp.settingsTextCopyModel.examples",
  },
  settingsImageModel: {
    titleKey: "settings.provider.imageModelLabel",
    introKey: "detail.parameterHelp.settingsImageModel.intro",
    examplesKey: "detail.parameterHelp.settingsImageModel.examples",
  },
  settingsGenerationPriority: {
    titleKey: "settings.generation.priority",
    introKey: "detail.parameterHelp.settingsGenerationPriority.intro",
    examplesKey: "detail.parameterHelp.settingsGenerationPriority.examples",
  },
  settingsGenerationMaxConcurrency: {
    titleKey: "settings.generation.maxConcurrency",
    introKey: "detail.parameterHelp.settingsGenerationMaxConcurrency.intro",
    examplesKey: "detail.parameterHelp.settingsGenerationMaxConcurrency.examples",
  },
  settingsGenerationAvailabilityWindow: {
    titleKey: "settings.generation.availabilityWindow",
    introKey: "detail.parameterHelp.settingsGenerationAvailabilityWindow.intro",
    examplesKey: "detail.parameterHelp.settingsGenerationAvailabilityWindow.examples",
  },
  settingsGenerationFailureThreshold: {
    titleKey: "settings.generation.failureThreshold",
    introKey: "detail.parameterHelp.settingsGenerationFailureThreshold.intro",
    examplesKey: "detail.parameterHelp.settingsGenerationFailureThreshold.examples",
  },
  settingsGenerationCooldownMinutes: {
    titleKey: "settings.generation.cooldownMinutes",
    introKey: "detail.parameterHelp.settingsGenerationCooldownMinutes.intro",
    examplesKey: "detail.parameterHelp.settingsGenerationCooldownMinutes.examples",
  },
  settingsResponsesBackground: {
    titleKey: "settings.provider.responsesBackground",
    introKey: "detail.parameterHelp.settingsResponsesBackground.intro",
    examplesKey: "detail.parameterHelp.settingsResponsesBackground.examples",
  },
  settingsGeminiApiVersion: {
    titleKey: "settings.provider.geminiApiVersionLabel",
    introKey: "detail.parameterHelp.settingsGeminiApiVersion.intro",
    examplesKey: "detail.parameterHelp.settingsGeminiApiVersion.examples",
  },
  settingsGeminiOutputMimeType: {
    titleKey: "settings.provider.geminiOutputMimeTypeLabel",
    introKey: "detail.parameterHelp.settingsGeminiOutputMimeType.intro",
    examplesKey: "detail.parameterHelp.settingsGeminiOutputMimeType.examples",
  },
  settingsImagesQuality: {
    titleKey: "settings.provider.imagesQualityLabel",
    introKey: "detail.parameterHelp.settingsImagesQuality.intro",
    examplesKey: "detail.parameterHelp.settingsImagesQuality.examples",
  },
  settingsImagesStyle: {
    titleKey: "settings.provider.imagesStyleLabel",
    introKey: "detail.parameterHelp.settingsImagesStyle.intro",
    examplesKey: "detail.parameterHelp.settingsImagesStyle.examples",
  },
};

export function isStaticParameterHelpKey(key: ParameterHelpKey): key is StaticParameterHelpKey {
  return Object.prototype.hasOwnProperty.call(PARAMETER_HELP_REGISTRY, key);
}
