/**
 * Scenario tests for AuthButton logout behavior.
 *
 * Covers the regression case where a backend OIDC user signs out on a shared
 * browser: DF must clear the backend session and immediately fall back to the
 * anonymous browser identity in persisted frontend state.
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    flush: vi.fn(async () => {}),
    getAuthInfo: vi.fn(),
    getUserManager: vi.fn(),
    getBrowserId: vi.fn(() => "browser-123"),
}));

vi.mock("react-redux", () => ({
    useDispatch: () => mocks.dispatch,
    useSelector: (selector: any) => selector({
        identity: {
            type: "user",
            id: "alice",
            displayName: "Alice",
        },
    }),
}));

vi.mock("../../../../src/app/store", () => ({
    persistor: {
        flush: () => mocks.flush(),
    },
}));

vi.mock("../../../../src/app/oidcConfig", () => ({
    getAuthInfo: () => mocks.getAuthInfo(),
    getUserManager: () => mocks.getUserManager(),
}));

vi.mock("../../../../src/app/identity", () => ({
    getBrowserId: () => mocks.getBrowserId(),
}));

vi.mock("react-i18next", () => ({
    initReactI18next: {
        type: "3rdParty",
        init: vi.fn(),
    },
    useTranslation: () => ({
        t: (key: string) => ({
            "auth.signOut": "Sign out",
            "auth.ssoDescription": "Single sign-on",
            "auth.ssoLogin": "Sign in",
        }[key] ?? key),
    }),
}));

import { AuthButton } from "../../../../src/app/AuthButton";
import { dfActions } from "../../../../src/app/dfSlice";

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    mocks.getAuthInfo.mockResolvedValue({
        action: "backend",
        logout_url: "/api/auth/oidc/logout",
    });
    mocks.getUserManager.mockResolvedValue(null);

    globalThis.fetch = vi.fn(async () => new Response(
        JSON.stringify({ status: "ok" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "/workspace" },
    });
});

describe("AuthButton backend logout", () => {
    it("clears backend session and switches persisted identity to browser", async () => {
        render(<AuthButton />);

        await waitFor(() => {
            expect(screen.getByText("Alice")).toBeInTheDocument();
        });

        await waitFor(() => {
            expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
        });

        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

        await waitFor(() => {
            expect(globalThis.fetch).toHaveBeenCalledWith(
                "/api/auth/oidc/logout",
                { method: "POST" },
            );
        });
        expect(mocks.dispatch).toHaveBeenCalledWith(
            dfActions.setIdentity({ type: "browser", id: "browser-123" }),
        );
        expect(localStorage.getItem("df_identity_type")).toBe("browser");
        expect(localStorage.getItem("df_browser_id")).toBe("browser-123");
        expect(mocks.flush).toHaveBeenCalledOnce();
        expect(window.location.href).toBe("/");
    });
});
