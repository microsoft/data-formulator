/**
 * Tests for OidcCallback component error-parameter handling.
 *
 * When the IdP redirects back with ?error=access_denied (user cancelled),
 * the component must redirect to /?auth_error=access_denied instead of
 * attempting signinRedirectCallback().
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";

const mocks = vi.hoisted(() => ({
    getUserManager: vi.fn(),
    signinRedirectCallback: vi.fn(),
    signinRedirect: vi.fn(),
}));

vi.mock("../../../../src/app/oidcConfig", () => ({
    getUserManager: () => mocks.getUserManager(),
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, opts?: any) => opts?.message ? `${key}: ${opts.message}` : key,
    }),
}));

import { OidcCallback } from "../../../../src/app/OidcCallback";

const theme = createTheme();
let locationHref = "/auth/callback";

function renderCallback() {
    return render(
        <ThemeProvider theme={theme}>
            <OidcCallback />
        </ThemeProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();

    const mgr = {
        signinRedirectCallback: mocks.signinRedirectCallback,
        signinRedirect: mocks.signinRedirect,
    };
    mocks.getUserManager.mockResolvedValue(mgr);
    mocks.signinRedirectCallback.mockResolvedValue({});

    locationHref = "/auth/callback";
    Object.defineProperty(window, "location", {
        writable: true,
        configurable: true,
        value: {
            get href() { return locationHref; },
            set href(v: string) { locationHref = v; },
            search: "",
            origin: "http://localhost:3000",
        },
    });
});

describe("OidcCallback error handling", () => {
    it("redirects to /?auth_error=access_denied when IdP returns error", async () => {
        (window.location as any).search = "?error=access_denied&state=abc";

        renderCallback();

        await waitFor(() => {
            expect(locationHref).toBe("/?auth_error=access_denied");
        });
        expect(mocks.signinRedirectCallback).not.toHaveBeenCalled();
    });

    it("redirects with encoded error for other IdP error values", async () => {
        (window.location as any).search = "?error=consent_required&state=abc";

        renderCallback();

        await waitFor(() => {
            expect(locationHref).toBe("/?auth_error=consent_required");
        });
        expect(mocks.signinRedirectCallback).not.toHaveBeenCalled();
    });

    it("proceeds with signinRedirectCallback when no error param", async () => {
        (window.location as any).search = "?code=auth-code&state=abc";

        renderCallback();

        await waitFor(() => {
            expect(mocks.signinRedirectCallback).toHaveBeenCalled();
        });
    });
});
