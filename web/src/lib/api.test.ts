import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

function inspirationDetailResponse() {
  return new Response(
    JSON.stringify({
      id: "inspiration-1",
      owner_user_id: "user-1",
      owner_username: null,
      resource_group_id: "group-default",
      resource_group: { id: "group-default", key: "default", name: "default" },
      name: "三阶魔方",
      category: null,
      price: null,
      source_note: "顺滑磁吸结构",
      workflow_state: "draft",
      source_assets: [],
      latest_brief: null,
      current_confirmed_copy_set: null,
      copy_sets: [],
      poster_variants: [],
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

describe("api.createInspiration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes rich inspiration context fields into multipart form data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(inspirationDetailResponse());
    const image = new File(["image"], "cube.png", { type: "image/png" });
    const documentFile = new File(["brief"], "brief.md", { type: "text/markdown" });

    await api.createInspiration({
      name: "三阶魔方",
      resource_group_id: "group-default",
      long_text: "顺滑磁吸结构",
      dynamic_fields: { magnetic: true, level: 3, note: null },
      initial_workflow_entry: "copy",
      entry_text: "顺滑磁吸结构",
      file: image,
      contextDocumentFile: documentFile,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body as FormData;
    expect(body.get("name")).toBe("三阶魔方");
    expect(body.get("resource_group_id")).toBe("group-default");
    expect(body.has("owner_id")).toBe(false);
    expect(body.get("long_text")).toBe("顺滑磁吸结构");
    expect(body.get("initial_workflow_entry")).toBe("copy");
    expect(body.get("entry_text")).toBe("顺滑磁吸结构");
    expect(body.get("dynamic_fields_json")).toBe(JSON.stringify({ magnetic: true, level: 3, note: null }));
    expect(body.get("image")).toBe(image);
    expect(body.get("context_document")).toBe(documentFile);
  });
});
