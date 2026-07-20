/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";
import { api } from "../lib/api";
import type { RbacRole, RbacUser, RbacUserListResponse } from "../lib/types";
import { RbacPage } from "./RbacPage";

vi.mock("../components/TopNav", () => ({
  TopNav: () => <nav aria-label="test-navigation" />,
}));

const role: RbacRole = {
  id: "role-1",
  code: "operator",
  name: "运营",
  is_admin: false,
  user_count: 1,
};

const user: RbacUser = {
  id: "user-1",
  username: "alice",
  display_name: "Alice",
  role_id: role.id,
  role_name: role.name,
  is_admin: false,
  enabled: true,
  password_pending: false,
  last_login_at: null,
  last_seen_at: null,
  session_revoked_after: null,
  possibly_online: false,
  resource_groups: [],
};

function userList(items: RbacUser[] = []): RbacUserListResponse {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
  };
}

function mockRbacDependencies() {
  vi.spyOn(api, "listRbacRoles").mockResolvedValue([role]);
  vi.spyOn(api, "listRbacPermissionCatalog").mockResolvedValue({ menus: [], api_permissions: [] });
  vi.spyOn(api, "getRbacRolePermissions").mockResolvedValue({
    role_id: role.id,
    menu_codes: [],
    api_permission_codes: [],
  });
}

function renderRbacPage(children: ReactNode = <RbacPage />) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RbacPage async regions", () => {
  it("keeps the page shell visible while the user table renders structural skeleton rows", () => {
    mockRbacDependencies();
    vi.spyOn(api, "listRbacUsers").mockImplementation(() => new Promise(() => undefined));

    const { container } = renderRbacPage();

    expect(screen.getByRole("heading", { name: "权限管理" })).toBeTruthy();
    expect(screen.getByText("新增授信用户")).toBeTruthy();
    expect(container.querySelectorAll(".pf-skeleton").length).toBeGreaterThan(0);
  });

  it("retries a failed user list without replacing the page shell", async () => {
    mockRbacDependencies();
    const usersRequest = vi
      .spyOn(api, "listRbacUsers")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(userList());

    renderRbacPage();

    expect(await screen.findByText("权限数据加载失败。")).toBeTruthy();
    expect(screen.getByText("新增授信用户")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(usersRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("没有匹配的用户。")).toBeTruthy();
  });

  it("keeps role creation visible when the role list fails and retries locally", async () => {
    vi.spyOn(api, "listRbacUsers").mockResolvedValue(userList());
    const rolesRequest = vi
      .spyOn(api, "listRbacRoles")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([role]);
    vi.spyOn(api, "listRbacPermissionCatalog").mockResolvedValue({ menus: [], api_permissions: [] });
    vi.spyOn(api, "getRbacRolePermissions").mockResolvedValue({
      role_id: role.id,
      menu_codes: [],
      api_permission_codes: [],
    });

    renderRbacPage();
    await userEvent.setup().click(screen.getByRole("tab", { name: "角色管理" }));

    expect(screen.getByText("新增角色")).toBeTruthy();
    expect(await screen.findByText("权限数据加载失败。")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(rolesRequest).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText("运营")).length).toBeGreaterThan(0);
  });

  it("retries failed resource-group grants inside the open dialog", async () => {
    mockRbacDependencies();
    vi.spyOn(api, "listRbacUsers").mockResolvedValue(userList([user]));
    const groupsRequest = vi
      .spyOn(api, "listGenerationResourceGroups")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    const grantsRequest = vi.spyOn(api, "getUserGenerationResourceGroupGrants").mockResolvedValue({
      user_id: user.id,
      resource_group_ids: [],
    });

    renderRbacPage();

    const grantButtons = await screen.findAllByRole("button", { name: "分组授权" });
    await userEvent.setup().click(grantButtons[0]!);

    const dialog = await screen.findByRole("dialog", { name: "生成分组授权" });
    expect(await within(dialog).findByText("生成分组授权加载失败。")).toBeTruthy();

    await userEvent.setup().click(within(dialog).getByRole("button", { name: "重试" }));

    await waitFor(() => expect(groupsRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(grantsRequest).toHaveBeenCalledTimes(2));
    expect(await within(dialog).findByText("当前没有可授权的生成分组。")).toBeTruthy();
  });
});
