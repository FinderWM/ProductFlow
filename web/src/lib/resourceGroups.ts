import type { GenerationResourceGroup } from "./types";

export function generationResourceGroupPriorityDesc(
  left: GenerationResourceGroup,
  right: GenerationResourceGroup,
): number {
  return (
    right.sort_order - left.sort_order ||
    left.created_at.localeCompare(right.created_at) ||
    left.name.localeCompare(right.name)
  );
}

export function activeGenerationResourceGroupsByPriority(
  groups: readonly GenerationResourceGroup[] | null | undefined,
): GenerationResourceGroup[] {
  return (groups ?? [])
    .filter((group) => group.enabled && !group.archived_at)
    .sort(generationResourceGroupPriorityDesc);
}

export function firstActiveGenerationResourceGroupId(
  groups: readonly GenerationResourceGroup[] | null | undefined,
): string {
  return activeGenerationResourceGroupsByPriority(groups)[0]?.id ?? "";
}
