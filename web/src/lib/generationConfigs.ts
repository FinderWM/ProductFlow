import type { GenerationConfigOption, ProviderPurpose } from "./types";

export function generationConfigResourceGroupIds(config: GenerationConfigOption): string[] {
  return config.resource_group_ids?.length
    ? config.resource_group_ids
    : config.resource_group_id
      ? [config.resource_group_id]
      : [];
}

export function generationConfigBelongsToResourceGroup(
  config: GenerationConfigOption,
  resourceGroupId: string | null,
): boolean {
  if (!resourceGroupId) {
    return false;
  }
  return generationConfigResourceGroupIds(config).includes(resourceGroupId);
}

export function generationConfigOptionsForPurpose(
  options: GenerationConfigOption[],
  purpose: ProviderPurpose,
  resourceGroupId: string | null,
): GenerationConfigOption[] {
  return options
    .filter(
      (config) =>
        config.purpose === purpose &&
        config.enabled &&
        generationConfigBelongsToResourceGroup(config, resourceGroupId),
    )
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
}

export function isGenerationConfigFrozenUntilActive(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export function generationConfigOptionLabel(
  config: GenerationConfigOption,
  disabledLabel: string,
  frozenLabel: string,
): string {
  const markers = [
    !config.enabled ? disabledLabel : "",
    isGenerationConfigFrozenUntilActive(config.frozen_until) ? frozenLabel : "",
  ].filter(Boolean);
  const suffix = markers.length ? ` (${markers.join(" · ")})` : "";
  return `${config.name} · ${config.provider_kind}${suffix}`;
}
