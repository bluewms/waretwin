import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("language choice preserves form input and follows navigation and reload", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Customer workspace" })).toBeVisible();
  await page.getByLabel("Workspace access token").fill("example-token");
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("zh-CN");
  await expect(page.getByLabel("工作台访问令牌")).toHaveValue("example-token");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await page.getByRole("link", { name: "打开演示" }).click();
  await expect(page.getByRole("combobox", { name: "语言", exact: true })).toHaveValue("zh-CN");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "语言", exact: true })).toHaveValue("zh-CN");

  await page.getByRole("combobox", { name: "语言", exact: true }).selectOption("en");
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Customer workspace" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
