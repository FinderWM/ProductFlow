import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import type { UserUiPreferences, UserUiPreferencesUpdateRequest } from "./types";
import { DEFAULT_UI_LAYOUT_SCHEME } from "./uiLayoutScheme";

export type SensitiveImageMaskPreferenceScope = "inspirations" | "image-chat";

export const DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED = true;
export const USER_UI_PREFERENCES_QUERY_KEY = ["user-ui-preferences"] as const;

export function sensitiveImageMaskPreferenceField(
  scope: SensitiveImageMaskPreferenceScope,
): keyof Pick<
  UserUiPreferences,
  "mask_sensitive_images_in_inspirations" | "mask_sensitive_images_in_image_chat"
> {
  return scope === "inspirations"
    ? "mask_sensitive_images_in_inspirations"
    : "mask_sensitive_images_in_image_chat";
}

export function resolveSensitiveImageMaskPreference(
  preferences: UserUiPreferences | null | undefined,
  scope: SensitiveImageMaskPreferenceScope,
): boolean {
  if (!preferences) {
    return DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED;
  }
  return preferences[sensitiveImageMaskPreferenceField(scope)];
}

export function sensitiveImageMaskPreferenceUpdate(
  scope: SensitiveImageMaskPreferenceScope,
  enabled: boolean,
): UserUiPreferencesUpdateRequest {
  return { [sensitiveImageMaskPreferenceField(scope)]: enabled };
}

function defaultUserUiPreferences(): UserUiPreferences {
  return {
    user_id: "",
    ui_layout_scheme: DEFAULT_UI_LAYOUT_SCHEME,
    mask_sensitive_images_in_inspirations: DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED,
    mask_sensitive_images_in_image_chat: DEFAULT_SENSITIVE_IMAGE_MASK_ENABLED,
    created_at: "",
    updated_at: "",
  };
}

export function useSensitiveImageMaskPreference(
  scope: SensitiveImageMaskPreferenceScope,
): readonly [boolean, (enabled: boolean) => void] {
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery({
    queryKey: USER_UI_PREFERENCES_QUERY_KEY,
    queryFn: api.getUserUiPreferences,
  });
  const updateMutation = useMutation({
    mutationFn: api.updateUserUiPreferences,
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: USER_UI_PREFERENCES_QUERY_KEY });
      const previous = queryClient.getQueryData<UserUiPreferences>(USER_UI_PREFERENCES_QUERY_KEY);
      const next = previous ?? defaultUserUiPreferences();
      queryClient.setQueryData<UserUiPreferences>(USER_UI_PREFERENCES_QUERY_KEY, {
        ...next,
        ui_layout_scheme: payload.ui_layout_scheme ?? next.ui_layout_scheme,
        mask_sensitive_images_in_inspirations:
          payload.mask_sensitive_images_in_inspirations ?? next.mask_sensitive_images_in_inspirations,
        mask_sensitive_images_in_image_chat:
          payload.mask_sensitive_images_in_image_chat ?? next.mask_sensitive_images_in_image_chat,
      });
      return { previous };
    },
    onError: (_error, _payload, context) => {
      if (context?.previous) {
        queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, context.previous);
      } else {
        queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, defaultUserUiPreferences());
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(USER_UI_PREFERENCES_QUERY_KEY, data);
    },
  });

  const enabled = resolveSensitiveImageMaskPreference(preferencesQuery.data, scope);
  const setEnabled = (nextEnabled: boolean) => {
    updateMutation.mutate(sensitiveImageMaskPreferenceUpdate(scope, nextEnabled));
  };

  return [enabled, setEnabled] as const;
}
