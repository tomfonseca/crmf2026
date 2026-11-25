import { expect, test } from "@playwright/test";

// Native WebAuthn through Chromium's virtual authenticator, never a real
// operator credential. API replies are synthetic; Go/Postgres tests verify
// actual attestation/signature, origin, RP ID, UV and replay protection.
for (const realm of ["platform", "tenant"] as const) {
  test(`${realm} passkey enrollment and login stay separate from demo`, async ({
    page,
    context,
  }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      },
    );
    let authenticated = false;
    let credentialID = "";
    const prefix = realm === "platform" ? "/v1/hq" : "/v1";
    const app =
      realm === "platform"
        ? "http://localhost:5177/"
        : "http://localhost:5175/login";
    const origin =
      realm === "platform" ? "http://localhost:5177" : "http://localhost:5175";
    const identity = {
      user_id: "00000000-0000-7000-8000-000000000001",
      realm,
      store_ids: [],
      ...(realm === "tenant"
        ? { tenant_id: "00000000-0000-7000-8000-000000000002" }
        : {}),
      grants: [
        { role: realm === "platform" ? "platform_admin" : "network_admin" },
      ],
    };
    const codes = Array.from({ length: 10 }, (_, i) =>
      i.toString(16).padStart(32, "0"),
    );
    const actions: string[] = [];
    await page.route("http://localhost:8080/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "content-type,x-crmf-request",
        "Access-Control-Allow-Methods": "GET,POST",
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      };
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers });
      expect(path.startsWith(prefix + "/")).toBe(true);
      if (request.method() === "POST")
        expect(request.headers()["x-crmf-request"]).toBe("1");
      if (path === prefix + "/me")
        return route.fulfill({
          status: authenticated ? 200 : 401,
          headers,
          body: authenticated ? JSON.stringify(identity) : "{}",
        });
      actions.push(path);
      if (path === prefix + "/auth/login") {
        const options = credentialID
          ? {
              challenge: Buffer.alloc(32, 2).toString("base64url"),
              rpId: "localhost",
              userVerification: "required",
              timeout: 60000,
              allowCredentials: [{ type: "public-key", id: credentialID }],
            }
          : {
              challenge: Buffer.alloc(32, 1).toString("base64url"),
              rp: { id: "localhost", name: "CRMF synthetic " + realm },
              user: {
                id: Buffer.from(realm + "-synthetic-handle").toString(
                  "base64url",
                ),
                name: "synthetic",
                displayName: "Synthetic user",
              },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
              authenticatorSelection: {
                residentKey: "required",
                requireResidentKey: true,
                userVerification: "required",
              },
              attestation: "none",
              timeout: 60000,
            };
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            status: credentialID ? "passkey_required" : "enrollment_required",
            public_key: JSON.stringify(options),
          }),
        });
      }
      if (path === prefix + "/auth/passkey") {
        const proof = JSON.parse(request.postDataJSON().response);
        expect(proof.type).toBe("public-key");
        const clientData = JSON.parse(
          Buffer.from(proof.response.clientDataJSON, "base64url").toString(),
        );
        expect(clientData.origin).toBe(origin);
        expect(clientData.type).toBe(
          credentialID ? "webauthn.get" : "webauthn.create",
        );
        const enrolling = !credentialID;
        credentialID = proof.id;
        authenticated = true;
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            status: "authenticated",
            ...(enrolling ? { recovery_codes: codes } : {}),
          }),
        });
      }
      if (path === prefix + "/auth/logout") {
        authenticated = false;
        return route.fulfill({ status: 204, headers });
      }
      return route.fulfill({ status: 404, headers, body: "{}" });
    });
    async function login() {
      await page
        .getByLabel("E-mail", { exact: true })
        .fill("fixture@example.invalid");
      await page
        .getByLabel("Senha", { exact: true })
        .fill("synthetic-password-only");
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
    }
    await page.goto(app);
    await login();
    await expect(
      page.getByRole("heading", { name: "Cadastrar passkey" }),
    ).toBeVisible();
    await expect(page.getByText("Sessão autenticada.")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Criar passkey", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Guarde seus códigos de recuperação" }),
    ).toBeVisible();
    await expect(page.getByText("Sessão autenticada.")).toHaveCount(0);
    await page.getByRole("button", { name: "Guardei os códigos" }).click();
    await expect(page.getByText("Sessão autenticada.")).toBeVisible();
    const { credentials } = await cdp.send("WebAuthn.getCredentials", {
      authenticatorId,
    });
    expect(credentials).toHaveLength(1);
    expect(credentials[0].isResidentCredential).toBe(true);
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await login();
    await expect(
      page.getByRole("heading", { name: "Verificar passkey" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Usar passkey", exact: true })
      .click();
    await expect(page.getByText("Sessão autenticada.")).toBeVisible();
    expect(
      await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    ).toEqual([0, 0]);
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
    expect(actions).toEqual([
      prefix + "/auth/login",
      prefix + "/auth/passkey",
      prefix + "/auth/logout",
      prefix + "/auth/login",
      prefix + "/auth/passkey",
      prefix + "/auth/logout",
    ]);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  });
}
test("mobile auth outage fails closed without demo fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.route("http://localhost:8080/v1/**", (route) =>
    route.abort("failed"),
  );
  await page.goto("/login");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByText(
      "Não foi possível verificar sua sessão. Nenhum acesso de demonstração foi concedido.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
