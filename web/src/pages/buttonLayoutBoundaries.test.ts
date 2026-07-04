import { describe, expect, it } from "vitest";
import enhancePageSource from "./EnhancePage.tsx?raw";
import galleryPageSource from "./GalleryPage.tsx?raw";
import helpPageSource from "./HelpPage.tsx?raw";
import imageChatPageSource from "./ImageChatPage.tsx?raw";
import imageToCodePageSource from "./ImageToCodePage.tsx?raw";
import inspirationCreatePageSource from "./InspirationCreatePage.tsx?raw";
import inspirationDetailPageSource from "./InspirationDetailPage.tsx?raw";
import inspirationListPageSource from "./InspirationListPage.tsx?raw";
import rbacPageSource from "./RbacPage.tsx?raw";
import resourceLibraryPageSource from "./ResourceLibraryPage.tsx?raw";
import settingsPageSource from "./SettingsPage.tsx?raw";
import statusPageSource from "./StatusPage.tsx?raw";
import templateManagementPageSource from "./TemplateManagementPage.tsx?raw";
import usageStatsPageSource from "./UsageStatsPage.tsx?raw";
import workspaceDateTimeRangeFieldSource from "../components/WorkspaceDateTimeRangeField.tsx?raw";
import confirmDialogSource from "../components/ConfirmDialog.tsx?raw";
import enhanceJobProgressSource from "../components/EnhanceJobProgress.tsx?raw";
import galleryImagePreviewDialogSource from "../components/GalleryImagePreviewDialog.tsx?raw";
import galleryTagPickerDialogSource from "../components/GalleryTagPickerDialog.tsx?raw";
import imageGenerationSettingsPanelSource from "../components/ImageGenerationSettingsPanel.tsx?raw";
import imageSizePickerSource from "../components/ImageSizePicker.tsx?raw";
import imageToolControlsSource from "../components/ImageToolControls.tsx?raw";
import layoutActionDropZoneSource from "../components/LayoutActionDropZone.tsx?raw";
import layoutActionSurfaceButtonSource from "../components/LayoutActionSurfaceButton.tsx?raw";
import layoutSwitchTabsSource from "../components/LayoutSwitchTabs.tsx?raw";
import markdownEditorSource from "../components/MarkdownEditor.tsx?raw";
import promptPreviewDialogSource from "../components/PromptPreviewDialog.tsx?raw";
import resourceGroupChipEditorSource from "../components/ResourceGroupChipEditor.tsx?raw";
import resourceLibraryModalSource from "../components/resource-library/ResourceLibraryModal.tsx?raw";
import saveToResourceLibraryDialogSource from "../components/resource-library/SaveToResourceLibraryDialog.tsx?raw";
import generationCanvasPlaceholderSource from "./image-chat/GenerationCanvasPlaceholder.tsx?raw";
import imageChatHistoryPanelSource from "./image-chat/ImageChatHistoryPanel.tsx?raw";
import imageChatSessionListSource from "./image-chat/ImageChatSessionList.tsx?raw";
import referencePanelsSource from "./image-chat/ReferencePanels.tsx?raw";
import deckPanelSource from "./inspiration-detail/DeckPanel.tsx?raw";
import imageDownloadComponentsSource from "./inspiration-detail/ImageDownloadComponents.tsx?raw";
import inspectorPanelSource from "./inspiration-detail/InspectorPanel.tsx?raw";
import runsPanelSource from "./inspiration-detail/RunsPanel.tsx?raw";
import sidebarTabButtonSource from "./inspiration-detail/SidebarTabButton.tsx?raw";
import tailSplitPlanDialogSource from "./inspiration-detail/TailSplitPlanDialog.tsx?raw";
import templateGroupsPanelSource from "./inspiration-detail/TemplateGroupsPanel.tsx?raw";
import settingsConfigTestPanelsSource from "./settings/components/ConfigTestPanels.tsx?raw";
import settingsCollapsibleModuleSource from "./settings/components/SettingsCollapsibleModule.tsx?raw";
import settingsSideRailSource from "./settings/components/SettingsSideRail.tsx?raw";
import settingsComponentStylesSource from "./settings/components/styles.ts?raw";

const CLASSIC_IMMERSIVE_FILES = [
  "./InspirationCreatePage.tsx",
  "./ImageChatPage.tsx",
  "./InspirationDetailPage.tsx",
  "./EnhancePage.tsx",
  "./image-chat/GenerationCanvasPlaceholder.tsx",
  "./image-chat/ImageChatHistoryPanel.tsx",
  "./image-chat/ImageChatSessionList.tsx",
  "./image-chat/ReferencePanels.tsx",
  "./inspiration-detail/DeckPanel.tsx",
  "./inspiration-detail/InspectorPanel.tsx",
  "./inspiration-detail/SidebarTabButton.tsx",
  "./inspiration-detail/TailSplitPlanDialog.tsx",
  "./inspiration-detail/TemplateGroupsPanel.tsx",
] as const;

const CLASSIC_MODAL_FILES = [
  {
    file: "./InspirationCreatePage.tsx",
    component: "ResourceLibraryModal",
    appearance: "actionAppearance",
  },
  {
    file: "./ImageChatPage.tsx",
    component: "ResourceLibraryModal",
    appearance: "actionAppearance",
  },
  {
    file: "./ImageChatPage.tsx",
    component: "SaveToResourceLibraryDialog",
    appearance: "actionAppearance",
  },
  {
    file: "./InspirationDetailPage.tsx",
    component: "ResourceLibraryModal",
    appearance: 'workspaceSubpage ? "workspace" : "classic"',
  },
  {
    file: "./InspirationDetailPage.tsx",
    component: "SaveToResourceLibraryDialog",
    appearance: 'workspaceSubpage ? "workspace" : "classic"',
  },
  {
    file: "./inspiration-detail/DeckPanel.tsx",
    component: "ResourceLibraryModal",
    appearance: 'workspaceSubpage ? "workspace" : "classic"',
  },
] as const;

const PAGE_SOURCE_BY_PATH: Record<(typeof CLASSIC_IMMERSIVE_FILES)[number], string> = {
  "./InspirationCreatePage.tsx": inspirationCreatePageSource,
  "./ImageChatPage.tsx": imageChatPageSource,
  "./InspirationDetailPage.tsx": inspirationDetailPageSource,
  "./EnhancePage.tsx": enhancePageSource,
  "./image-chat/GenerationCanvasPlaceholder.tsx": generationCanvasPlaceholderSource,
  "./image-chat/ImageChatHistoryPanel.tsx": imageChatHistoryPanelSource,
  "./image-chat/ImageChatSessionList.tsx": imageChatSessionListSource,
  "./image-chat/ReferencePanels.tsx": referencePanelsSource,
  "./inspiration-detail/DeckPanel.tsx": deckPanelSource,
  "./inspiration-detail/InspectorPanel.tsx": inspectorPanelSource,
  "./inspiration-detail/SidebarTabButton.tsx": sidebarTabButtonSource,
  "./inspiration-detail/TailSplitPlanDialog.tsx": tailSplitPlanDialogSource,
  "./inspiration-detail/TemplateGroupsPanel.tsx": templateGroupsPanelSource,
};

function readPageSource(relativePath: (typeof CLASSIC_IMMERSIVE_FILES)[number]) {
  return PAGE_SOURCE_BY_PATH[relativePath];
}

const LAYOUT_AWARE_BUTTON_SOURCES = [
  { file: "./InspirationListPage.tsx", source: inspirationListPageSource },
  { file: "./ResourceLibraryPage.tsx", source: resourceLibraryPageSource },
  { file: "./GalleryPage.tsx", source: galleryPageSource },
  { file: "./EnhancePage.tsx", source: enhancePageSource },
  { file: "./ImageToCodePage.tsx", source: imageToCodePageSource },
  { file: "./TemplateManagementPage.tsx", source: templateManagementPageSource },
  { file: "./StatusPage.tsx", source: statusPageSource },
  { file: "./UsageStatsPage.tsx", source: usageStatsPageSource },
  { file: "./SettingsPage.tsx", source: settingsPageSource },
  { file: "./RbacPage.tsx", source: rbacPageSource },
  { file: "./HelpPage.tsx", source: helpPageSource },
  { file: "./settings/components/ConfigTestPanels.tsx", source: settingsConfigTestPanelsSource },
  { file: "./settings/components/styles.ts", source: settingsComponentStylesSource },
  { file: "../components/resource-library/ResourceLibraryModal.tsx", source: resourceLibraryModalSource },
  { file: "../components/resource-library/SaveToResourceLibraryDialog.tsx", source: saveToResourceLibraryDialogSource },
  { file: "../components/WorkspaceDateTimeRangeField.tsx", source: workspaceDateTimeRangeFieldSource },
] as const;

const LAYOUT_AWARE_DATE_RANGE_PAGES = [
  { file: "./InspirationListPage.tsx", source: inspirationListPageSource },
  { file: "./StatusPage.tsx", source: statusPageSource },
  { file: "./UsageStatsPage.tsx", source: usageStatsPageSource },
] as const;

const OBJECTIVE_PAGE_SOURCES_WITHOUT_RAW_BUTTONS = [
  { file: "./InspirationListPage.tsx", source: inspirationListPageSource },
  { file: "./InspirationCreatePage.tsx", source: inspirationCreatePageSource },
  { file: "./InspirationDetailPage.tsx", source: inspirationDetailPageSource },
  { file: "./GalleryPage.tsx", source: galleryPageSource },
  { file: "./EnhancePage.tsx", source: enhancePageSource },
  { file: "./ImageToCodePage.tsx", source: imageToCodePageSource },
  { file: "./TemplateManagementPage.tsx", source: templateManagementPageSource },
  { file: "./StatusPage.tsx", source: statusPageSource },
  { file: "./UsageStatsPage.tsx", source: usageStatsPageSource },
  { file: "./SettingsPage.tsx", source: settingsPageSource },
  { file: "./RbacPage.tsx", source: rbacPageSource },
  { file: "./inspiration-detail/DeckPanel.tsx", source: deckPanelSource },
  { file: "./inspiration-detail/InspectorPanel.tsx", source: inspectorPanelSource },
  { file: "./inspiration-detail/RunsPanel.tsx", source: runsPanelSource },
  { file: "./inspiration-detail/TemplateGroupsPanel.tsx", source: templateGroupsPanelSource },
] as const;

function countPattern(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

const SHARED_LAYOUT_COMPONENT_SOURCES = [
  { file: "../components/ConfirmDialog.tsx", source: confirmDialogSource },
  { file: "../components/EnhanceJobProgress.tsx", source: enhanceJobProgressSource },
  { file: "../components/GalleryImagePreviewDialog.tsx", source: galleryImagePreviewDialogSource },
  { file: "../components/GalleryTagPickerDialog.tsx", source: galleryTagPickerDialogSource },
  { file: "../components/MarkdownEditor.tsx", source: markdownEditorSource },
  { file: "../components/PromptPreviewDialog.tsx", source: promptPreviewDialogSource },
  { file: "../components/ResourceGroupChipEditor.tsx", source: resourceGroupChipEditorSource },
  { file: "./settings/components/SettingsCollapsibleModule.tsx", source: settingsCollapsibleModuleSource },
  { file: "./inspiration-detail/TemplateGroupsPanel.tsx", source: templateGroupsPanelSource },
] as const;

const SHARED_COMPONENT_APPEARANCE_REQUIREMENTS = [
  {
    file: "./InspirationListPage.tsx",
    source: inspirationListPageSource,
    component: "ConfirmDialog",
    appearance: 'isWorkspaceSubpage ? "workspace" : "classic"',
    minCount: 1,
  },
  {
    file: "./GalleryPage.tsx",
    source: galleryPageSource,
    component: "GalleryImagePreviewDialog",
    appearance: "galleryActionAppearance",
    minCount: 2,
  },
  {
    file: "./GalleryPage.tsx",
    source: galleryPageSource,
    component: "GalleryTagPickerDialog",
    appearance: "galleryActionAppearance",
    minCount: 2,
  },
  {
    file: "./GalleryPage.tsx",
    source: galleryPageSource,
    component: "ConfirmDialog",
    appearance: "galleryActionAppearance",
    minCount: 1,
  },
  {
    file: "./EnhancePage.tsx",
    source: enhancePageSource,
    component: "EnhanceJobProgress",
    appearance: "enhanceActionAppearance",
    minCount: 1,
  },
  {
    file: "./EnhancePage.tsx",
    source: enhancePageSource,
    component: "ConfirmDialog",
    appearance: "enhanceActionAppearance",
    minCount: 1,
  },
  {
    file: "./EnhancePage.tsx",
    source: enhancePageSource,
    component: "GalleryImagePreviewDialog",
    appearance: "enhanceActionAppearance",
    minCount: 1,
  },
  {
    file: "./ImageToCodePage.tsx",
    source: imageToCodePageSource,
    component: "ConfirmDialog",
    appearance: "imageToCodeActionAppearance",
    minCount: 1,
  },
  {
    file: "./ImageChatPage.tsx",
    source: imageChatPageSource,
    component: "EnhanceJobProgress",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "./ImageChatPage.tsx",
    source: imageChatPageSource,
    component: "GalleryImagePreviewDialog",
    appearance: "actionAppearance",
    minCount: 2,
  },
  {
    file: "./ImageChatPage.tsx",
    source: imageChatPageSource,
    component: "GalleryTagPickerDialog",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "./ImageChatPage.tsx",
    source: imageChatPageSource,
    component: "PromptPreviewDialog",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "./InspirationDetailPage.tsx",
    source: inspirationDetailPageSource,
    component: "ConfirmDialog",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "./InspirationDetailPage.tsx",
    source: inspirationDetailPageSource,
    component: "ConfirmDialog",
    appearance: "actionAppearance",
    minCount: 2,
  },
  {
    file: "./ResourceLibraryPage.tsx",
    source: resourceLibraryPageSource,
    component: "ResourceGroupChipEditor",
    appearance: "resourceLibraryActionAppearance(workspaceSubpage)",
    minCount: 1,
  },
  {
    file: "./ResourceLibraryPage.tsx",
    source: resourceLibraryPageSource,
    component: "GalleryImagePreviewDialog",
    appearance: "resourceLibraryActionAppearance(workspaceSubpage)",
    minCount: 1,
  },
  {
    file: "./ResourceLibraryPage.tsx",
    source: resourceLibraryPageSource,
    component: "ConfirmDialog",
    appearance: "resourceLibraryActionAppearance(workspaceSubpage)",
    minCount: 1,
  },
  {
    file: "./SettingsPage.tsx",
    source: settingsPageSource,
    component: "ImageConfigTestResultDialog",
    appearance: 'isWorkspaceSubpage ? "workspace" : "classic"',
    minCount: 1,
  },
  {
    file: "./SettingsPage.tsx",
    source: settingsPageSource,
    component: "GalleryTagPickerDialog",
    appearance: 'isWorkspaceSubpage ? "workspace" : "classic"',
    minCount: 1,
  },
  {
    file: "./SettingsPage.tsx",
    source: settingsPageSource,
    component: "ConfirmDialog",
    appearance: 'isWorkspaceSubpage ? "workspace" : "classic"',
    minCount: 4,
  },
  {
    file: "./TemplateManagementPage.tsx",
    source: templateManagementPageSource,
    component: "ConfirmDialog",
    appearance: "templateActionAppearance(isWorkspaceSubpage)",
    minCount: 1,
  },
  {
    file: "./RbacPage.tsx",
    source: rbacPageSource,
    component: "ConfirmDialog",
    appearance: 'isWorkspaceSubpage ? "workspace" : "classic"',
    minCount: 1,
  },
  {
    file: "./inspiration-detail/InspectorPanel.tsx",
    source: inspectorPanelSource,
    component: "PromptPreviewDialog",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "./inspiration-detail/InspectorPanel.tsx",
    source: inspectorPanelSource,
    component: "DownloadLink",
    appearance: "actionAppearance",
    minCount: 3,
  },
  {
    file: "./inspiration-detail/RunsPanel.tsx",
    source: runsPanelSource,
    component: "PromptPreviewDialog",
    appearance: "actionAppearance",
    minCount: 1,
  },
  {
    file: "../components/resource-library/ResourceLibraryModal.tsx",
    source: resourceLibraryModalSource,
    component: "GalleryImagePreviewDialog",
    appearance: "appearance",
    minCount: 1,
  },
  {
    file: "./settings/components/ConfigTestPanels.tsx",
    source: settingsConfigTestPanelsSource,
    component: "SettingsCollapsibleModule",
    appearance: 'workspaceSubpage ? "workspace" : "classic"',
    minCount: 2,
  },
] as const;

const ACTION_BUTTON_DEFAULT_FALLBACK_RE =
  /action(?:Button(?:Component|ClassName)?|SurfaceClassName)ForAppearance\([\s\S]{0,160}"default"/;
const LAYOUT_APPEARANCE_DEFAULT_FALLBACK_RE =
  /(?:appearance|inputAppearance)\s*(?:\?:\s*[^=;\n]+|=\s*|:\s*)[\s\S]{0,80}"default"/;

describe("button layout boundaries for classic immersive routes", () => {
  it.each(CLASSIC_IMMERSIVE_FILES)("%s does not import the legacy ActionButton bridge", (file) => {
    const source = readPageSource(file);

    expect(source).not.toMatch(/from\s+["'][./]+components\/ActionButton["']/);
  });

  it.each(CLASSIC_IMMERSIVE_FILES)("%s does not import workspace button helpers", (file) => {
    const source = readPageSource(file);

    expect(source).not.toContain("WorkspaceActionButton");
    expect(source).not.toContain("workspaceActionButtonClassName");
    expect(source).not.toContain("workspaceActionSurfaceClassName");
  });

  it.each(CLASSIC_MODAL_FILES)(
    "$file gives $component an explicit classic-safe appearance",
    ({ file, component, appearance }) => {
      const source = readPageSource(file);
      const escapedAppearance = appearance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      expect(source).toMatch(new RegExp(`<${component}[\\s\\S]*?appearance=\\{${escapedAppearance}\\}`));
      if (appearance === "actionAppearance") {
        expect(source).toContain('workspaceSubpage ? "workspace" : "classic"');
      }
    },
  );
});

describe("button layout boundaries for shared classic/workspace pages", () => {
  it.each(LAYOUT_AWARE_BUTTON_SOURCES)("$file does not import workspace button helpers directly", ({ source }) => {
    expect(source).not.toContain("WorkspaceActionButton");
    expect(source).not.toContain("workspaceActionButtonClassName");
    expect(source).not.toContain("workspaceActionSurfaceClassName");
  });

  it.each(LAYOUT_AWARE_BUTTON_SOURCES)("$file does not use default fallback for action buttons", ({ source }) => {
    expect(source).not.toMatch(ACTION_BUTTON_DEFAULT_FALLBACK_RE);
  });

  it("./InspirationCreatePage.tsx uses explicit classic/workspace markdown appearance", () => {
    expect(inspirationCreatePageSource).toContain('const markdownInputAppearance = workspaceSubpage ? "workspace" : "classic";');
  });

  it("./ImageChatPage.tsx uses explicit classic/workspace input appearance", () => {
    expect(imageChatPageSource).toContain('const inputAppearance = workspaceSubpage ? "workspace" : "classic";');
  });

  it("./EnhancePage.tsx uses explicit classic/workspace image-size appearance", () => {
    expect(enhancePageSource).toContain('appearance={workspaceSubpage ? "workspace" : "classic"}');
  });

  it("./settings/components/ConfigTestPanels.tsx uses explicit classic/workspace image-size appearance", () => {
    expect(settingsConfigTestPanelsSource).toContain('appearance={workspaceSubpage ? "workspace" : "classic"}');
  });

  it("./inspiration-detail/TailSplitPlanDialog.tsx uses explicit classic/workspace image settings appearance", () => {
    expect(tailSplitPlanDialogSource).toContain('appearance={workspaceSubpage ? "workspace" : "classic"}');
  });

  it("./ResourceLibraryPage.tsx does not keep legacy settings nav item classes for group buttons", () => {
    expect(resourceLibraryPageSource).not.toContain("pf-settings-nav-item");
  });

  it("./ResourceLibraryPage.tsx keeps group rail entries on resource-library nav styling instead of action surfaces", () => {
    expect(resourceLibraryPageSource).toContain("pf-resource-library-group-nav-item");
    expect(resourceLibraryPageSource).toMatch(
      /const groupNavButtonClassName = \(active: boolean, extraClassName = ""\) =>[\s\S]*?pf-resource-library-group-nav-item/,
    );
  });

  it("./settings/components/SettingsSideRail.tsx keeps settings navigation on nav-item styling", () => {
    expect(settingsSideRailSource).toContain("pf-settings-nav-item");
    expect(settingsSideRailSource).not.toContain("actionSurfaceClassNameForAppearance");
  });

  it("./HelpPage.tsx keeps help side navigation on nav-item styling", () => {
    expect(helpPageSource).toContain("pf-help-nav-item");
    expect(helpPageSource).not.toContain("actionSurfaceClassNameForAppearance(appearance");
  });

  it("./InspirationListPage.tsx uses the layout-aware surface button for the collapsed search trigger", () => {
    expect(inspirationListPageSource).toContain("LayoutActionSurfaceButton");
    expect(inspirationListPageSource).toContain('appearance={actionAppearance}');
  });

  it("./GalleryPage.tsx uses the layout-aware surface button for base-asset preview cards", () => {
    expect(galleryPageSource).toContain("LayoutActionSurfaceButton");
    expect(galleryPageSource).toContain('appearance={galleryActionAppearance}');
  });

  it("./GalleryPage.tsx uses the layout-aware surface button for main gallery entry cards", () => {
    expect(galleryPageSource).toMatch(
      /<LayoutActionSurfaceButton[\s\S]*?onClick=\{\(\) => handleEntryClick\(entry\)\}[\s\S]*?toneVars=\{transparentActionToneVars\}/,
    );
  });

  it("./RbacPage.tsx keeps role selection cards on layout-aware surfaces instead of settings-only option classes", () => {
    expect(rbacPageSource).toContain("LayoutActionSurfaceButton");
    expect(rbacPageSource).toMatch(
      /<LayoutActionSurfaceButton[\s\S]*?aria-pressed=\{active\}[\s\S]*?onClick=\{\(\) => setSelectedPermissionRoleId\(role.id\)\}/,
    );
    expect(rbacPageSource).not.toContain("pf-settings-provider-option");
  });

  it("./RbacPage.tsx renders user and role management as layout-aware tabs instead of action buttons", () => {
    expect(rbacPageSource).toContain("LayoutSwitchTabs");
    expect(rbacPageSource).toContain("appearance={actionAppearance}");
    expect(rbacPageSource).not.toMatch(/<PageActionButton[\s\S]*?role="tab"/);
    expect(layoutSwitchTabsSource).toContain("pf-classic-horizontal-switch-tabs");
    expect(layoutSwitchTabsSource).toContain("pf-workspace-horizontal-switch-tabs");
    expect(layoutSwitchTabsSource).toContain("pf-settings-generation-tab");
  });

  it("./inspiration-detail/SidebarTabButton.tsx renders rail entries as tabs instead of action buttons", () => {
    expect(sidebarTabButtonSource).toContain('role="tab"');
    expect(sidebarTabButtonSource).toContain("aria-selected");
    expect(sidebarTabButtonSource).toContain("pf-sidebar-rail-tab");
    expect(sidebarTabButtonSource).not.toContain("actionButtonComponentForAppearance");
    expect(sidebarTabButtonSource).not.toContain("aria-pressed");
  });

  it("./ResourceLibraryPage.tsx uses the layout-aware surface button for asset preview cards", () => {
    expect(resourceLibraryPageSource).toContain("LayoutActionSurfaceButton");
    expect(resourceLibraryPageSource).toContain('appearance={resourceLibraryActionAppearance(workspaceSubpage)}');
  });

  it("./ResourceLibraryPage.tsx uses the layout-aware drop zone for manual image uploads", () => {
    expect(resourceLibraryPageSource).toContain("LayoutActionDropZone");
    expect(resourceLibraryPageSource).toMatch(
      /<LayoutActionDropZone[\s\S]*?appearance=\{resourceLibraryActionAppearance\(workspaceSubpage\)\}[\s\S]*?resourceLibrary\.uploadAction/,
    );
    expect(resourceLibraryPageSource).toMatch(/<LayoutActionDropZone[\s\S]*?size="lg"[\s\S]*?fullWidth[\s\S]*?min-h-12/);
    expect(resourceLibraryPageSource).not.toContain("resourceLibraryActionSurfaceClassName");
    expect(resourceLibraryPageSource).not.toContain("pf-action-surface--dashed");
  });

  it("../components/LayoutActionDropZone.tsx reuses layout action surfaces and action button sizes", () => {
    expect(layoutActionDropZoneSource).toContain("actionSurfaceClassNameForAppearance(appearance");
    expect(layoutActionDropZoneSource).toContain("ACTION_BUTTON_SIZE_CLASSNAME[size]");
    expect(layoutActionDropZoneSource).toContain("pf-layout-action-drop-zone");
  });

  it("./inspiration-detail/TemplateGroupsPanel.tsx uses the layout-aware surface button for compact template previews", () => {
    expect(templateGroupsPanelSource).toContain("LayoutActionSurfaceButton");
    expect(templateGroupsPanelSource).toContain("appearance={actionAppearance}");
  });

  it("./inspiration-detail/DeckPanel.tsx uses the layout-aware surface button for deck history selection", () => {
    expect(deckPanelSource).toContain("LayoutActionSurfaceButton");
    expect(deckPanelSource).toMatch(
      /<LayoutActionSurfaceButton[\s\S]*?onClick=\{\(\) => setSelectedDeckId\(item.id\)\}[\s\S]*?aria-pressed=\{selectedDeckId === item.id\}/,
    );
  });

  it("./HelpPage.tsx keeps doc page navigation surfaces on the layout-aware surface button", () => {
    expect(helpPageSource).toContain("LayoutActionSurfaceButton");
    expect(helpPageSource).toContain('appearance={helpActionAppearance}');
  });

  it("./inspiration-detail/InspectorPanel.tsx keeps add-dynamic-field on the layout-aware action button", () => {
    expect(inspectorPanelSource).toMatch(
      /<ActionButton[\s\S]*?onClick=\{addDynamicField\}[\s\S]*?preset="secondary"[\s\S]*?size="sm"/,
    );
    expect(inspectorPanelSource).not.toContain("compactSecondaryButtonClassName");
  });

  it("./inspiration-detail/InspectorPanel.tsx uses layout-aware surface buttons for deck/media preview thumbnails", () => {
    expect(inspectorPanelSource).toContain("LayoutActionSurfaceButton");
    expect(inspectorPanelSource).toMatch(/<LayoutActionSurfaceButton[\s\S]*?onClick=\{\(\) => onPreviewImage\(image\)\}/);
    expect(inspectorPanelSource).toMatch(/<LayoutActionSurfaceButton[\s\S]*?onClick=\{\(\) => onPreviewImage\(previewImage\)\}/);
  });

  it("./inspiration-detail/InspectorPanel.tsx uses the layout-aware surface button for the main reference-image preview", () => {
    expect(inspectorPanelSource).toMatch(
      /<LayoutActionSurfaceButton[\s\S]*?onClick=\{\(\) => onPreviewImage\(image\)\}[\s\S]*?toneVars=\{transparentActionToneVars\}/,
    );
  });

  it.each(LAYOUT_AWARE_DATE_RANGE_PAGES)(
    "$file uses explicit classic/workspace datetime range entries instead of the workspace-only component",
    ({ source }) => {
      expect(source).toContain("ClassicDateTimeRangeField");
      expect(source).toContain("WorkspaceDateTimeRangeField");
      expect(source).not.toContain("LayoutDateTimeRangeField");
    },
  );

  it.each(SHARED_LAYOUT_COMPONENT_SOURCES)(
    "$file does not hardcode workspace-only or legacy pf-btn button classes",
    ({ source }) => {
      expect(source).not.toContain("pf-workspace-action-primary");
      expect(source).not.toContain("pf-workspace-action-secondary");
      expect(source).not.toContain("pf-workspace-action-danger");
      expect(source).not.toMatch(/pf-btn-(primary|secondary|danger)/);
    },
  );

  it.each([
    { file: "../components/ImageSizePicker.tsx", source: imageSizePickerSource },
    { file: "../components/ImageGenerationSettingsPanel.tsx", source: imageGenerationSettingsPanelSource },
    { file: "../components/ImageToolControls.tsx", source: imageToolControlsSource },
    { file: "../components/LayoutActionDropZone.tsx", source: layoutActionDropZoneSource },
    { file: "../components/LayoutActionSurfaceButton.tsx", source: layoutActionSurfaceButtonSource },
    { file: "../components/MarkdownEditor.tsx", source: markdownEditorSource },
  ])("$file does not keep a default classic/workspace appearance fallback", ({ source }) => {
    expect(source).not.toMatch(LAYOUT_APPEARANCE_DEFAULT_FALLBACK_RE);
  });

  it.each(SHARED_COMPONENT_APPEARANCE_REQUIREMENTS)(
    "$file passes explicit appearance to $component",
    ({ source, component, appearance, minCount }) => {
      const escapedAppearance = appearance.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = source.match(new RegExp(`<${component}[\\s\\S]*?appearance=\\{${escapedAppearance}\\}`, "g")) ?? [];

      expect(matches.length).toBeGreaterThanOrEqual(minCount);
    },
  );

  it.each(OBJECTIVE_PAGE_SOURCES_WITHOUT_RAW_BUTTONS)("$file no longer keeps raw button elements", ({ source }) => {
    expect(source).not.toContain("<button");
  });

  it("./ResourceLibraryPage.tsx keeps only navigation raw buttons after button refactor", () => {
    expect(countPattern(resourceLibraryPageSource, /<button\b/g)).toBe(3);
    expect(resourceLibraryPageSource).toContain("pf-resource-library-group-nav-item");
    expect(resourceLibraryPageSource).toContain("pf-resource-library-mobile-groups-trigger");
  });

  it("./HelpPage.tsx keeps only navigation raw buttons after button refactor", () => {
    expect(countPattern(helpPageSource, /<button\b/g)).toBe(1);
    expect(helpPageSource).toContain("pf-help-nav-item");
  });

  it("./inspiration-detail/ImageDownloadComponents.tsx uses explicit appearance-aware helpers", () => {
    expect(imageDownloadComponentsSource).toContain("actionButtonClassNameForAppearance(appearance");
    expect(imageDownloadComponentsSource).toContain("actionButtonComponentForAppearance(appearance)");
    expect(imageDownloadComponentsSource).toContain("LayoutActionSurfaceButton");
    expect(imageDownloadComponentsSource).not.toContain("<button");
    expect(imageDownloadComponentsSource).not.toMatch(/btn-secondary-spring|pf-workspace-action-|pf-btn-(primary|secondary|danger)/);
  });

  it("./inspiration-detail/DeckPanel.tsx does not keep the old custom legacy PPT download pill", () => {
    expect(deckPanelSource).not.toContain("bg-emerald-600");
    expect(deckPanelSource).toContain("deckLegacyDownloadClassName");
  });

  it.each([
    { file: "./EnhancePage.tsx", source: enhancePageSource },
    { file: "./ImageToCodePage.tsx", source: imageToCodePageSource },
  ])("$file does not handcraft pf-action-button inner spans for action links", ({ source }) => {
    expect(source).not.toContain('<span className="pf-action-button__icon">');
    expect(source).not.toContain('<span className="pf-action-button__label">');
  });
});
