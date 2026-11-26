import { expect, test } from "@playwright/test";
for (const realm of ["tenant", "platform"] as const) {
  for (const status of [202, 503]) {
    test(`${realm} recovery receipt ${status} is not delivery confirmation or automatic retry`, async ({
      page,
    }) => {
      const root =
        realm === "platform"
          ? "http://localhost:5177"
          : "http://localhost:5175";
      const base = realm === "platform" ? "/v1/hq" : "/v1";
      const path =
        realm === "platform" ? "/esqueci-senha" : "/login/esqueci-senha";
      let writes = 0;
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("http://localhost:8080/v1/**", async (route) => {
        const req = route.request();
        const headers = {
          "Access-Control-Allow-Origin": root,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Headers": "content-type,x-crmf-request",
          "Access-Control-Allow-Methods": "GET,POST",
          "Cache-Control": "no-store",
        };
        if (req.method() === "OPTIONS")
          return route.fulfill({ status: 204, headers });
        if (req.method() === "POST") {
          expect(new URL(req.url()).pathname).toBe(
            base + "/auth/password/forgot",
          );
          expect(req.headers()["x-crmf-request"]).toBe("1");
          expect(req.postDataJSON()).toEqual({
            email: "00000000-0000-4000-8000-000000000001@example.invalid",
          });
          writes++;
          return route.fulfill({ status, headers });
        }
        return route.fulfill({ status: 401, headers, body: "{}" });
      });
      await page.goto(root + path);
      await page
        .getByLabel("E-mail", { exact: true })
        .fill("00000000-0000-4000-8000-000000000001@example.invalid");
      await page
        .getByRole("button", { name: "Enviar instruções", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name:
            status === 202
              ? "Solicitação recebida"
              : "Resultado não confirmado",
          exact: true,
        }),
      ).toBeVisible();
      expect(writes).toBe(1);
      expect(
        await page.evaluate(() =>
          Object.values(localStorage).every(
            (v) => v === "light" || v === "dark",
          ),
        ),
      ).toBe(true);
      expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
      expect(await page.context().cookies()).toEqual([]);
      await page.setViewportSize({ width: 320, height: 800 });
      await page
        .getByRole("button", { name: "Usar tema escuro", exact: true })
        .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
