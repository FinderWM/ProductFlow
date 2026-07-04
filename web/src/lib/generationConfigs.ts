import type { GenerationConfigOption, GenerationConfigSelectionMode, ProviderPurpose } from "./types";

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
        config.effective_enabled &&
        generationConfigBelongsToResourceGroup(config, resourceGroupId),
    )
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
}

export function generationConfigOptionEffectiveMaxDimension(
  config: Pick<GenerationConfigOption, "provider_max_dimension">,
  globalMaxDimension: number,
): number {
  return config.provider_max_dimension ?? globalMaxDimension;
}

export function generationConfigOptionsMaxDimension(
  options: Array<Pick<GenerationConfigOption, "provider_max_dimension">>,
  globalMaxDimension: number,
): number {
  if (!options.length) {
    return globalMaxDimension;
  }
  return Math.max(
    ...options.map((config) => generationConfigOptionEffectiveMaxDimension(config, globalMaxDimension)),
  );
}

export function generationConfigSelectionMaxDimension({
  mode,
  generationConfigId,
  resourceGroupId,
  resourceGroupMaxDimension,
  options,
  globalMaxDimension,
}: {
  mode: GenerationConfigSelectionMode;
  generationConfigId: string | null;
  resourceGroupId: string | null;
  resourceGroupMaxDimension?: number | null;
  options: Array<Pick<GenerationConfigOption, "id" | "provider_max_dimension">>;
  globalMaxDimension: number;
}): number {
  if (mode === "manual" && generationConfigId) {
    const selectedConfig = options.find((config) => config.id === generationConfigId);
    if (selectedConfig) {
      return Math.min(
        generationConfigOptionEffectiveMaxDimension(selectedConfig, globalMaxDimension),
        globalMaxDimension,
      );
    }
  }
  if (resourceGroupMaxDimension != null) {
    return Math.min(resourceGroupMaxDimension, globalMaxDimension);
  }
  if (resourceGroupId) {
    return Math.min(generationConfigOptionsMaxDimension(options, globalMaxDimension), globalMaxDimension);
  }
  return globalMaxDimension;
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
