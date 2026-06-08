import type { GenerationResourceGroup } from "./types";

export function activeGenerationResourceGroupsInApiOrder(
  groups: readonly GenerationResourceGroup[] | null | undefined,
): GenerationResourceGroup[] {
  return (groups ?? []).filter((group) => group.enabled && !group.archived_at);
}

export function firstActiveGenerationResourceGroupId(
  groups: readonly GenerationResourceGroup[] | null | undefined,
): string {
  return activeGenerationResourceGroupsInApiOrder(groups)[0]?.id ?? "";
}
