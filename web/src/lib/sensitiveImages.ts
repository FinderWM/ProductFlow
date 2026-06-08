import type { GenerationResourceGroupTag } from "./types";

export function shouldMaskSensitiveImage(
  personalMaskEnabled: boolean,
  resourceGroup: Pick<GenerationResourceGroupTag, "blur_images_by_default"> | null | undefined,
): boolean {
  return personalMaskEnabled && Boolean(resourceGroup?.blur_images_by_default);
}

export function shouldShowSensitiveImageMaskPreference(
  selectedResourceGroupId: string | null | undefined,
  resourceGroups: readonly Pick<GenerationResourceGroupTag, "id" | "blur_images_by_default">[] | null | undefined,
): boolean {
  if (selectedResourceGroupId === "") {
    return true;
  }
  if (!selectedResourceGroupId) {
    return false;
  }
  return Boolean(
    resourceGroups?.some(
      (resourceGroup) => resourceGroup.id === selectedResourceGroupId && resourceGroup.blur_images_by_default,
    ),
  );
}
