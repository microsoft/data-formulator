/**
 * Scenario tests for IdentityMigrationDialog.
 *
 * Covers the user journey: anonymous user logs in via SSO, sees the
 * migration prompt, and chooses either "Start Fresh" or "Import Data".
 *
 * Key behavioral requirements:
 * - "Start Fresh" must NOT delete anonymous workspace data
 * - "Start Fresh" must NOT show "Importing workspaces…"
 * - "Import Data" calls the migrate endpoint and shows progress
 */
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetchWithIdentity = vi.fn();
const mockPurge = vi.fn(async () => {});

vi.mock("../../../../src/app/utils", () => ({
    fetchWithIdentity: (...args: any[]) => mockFetchWithIdentity(...args),
    getUrls: () => ({ SESSION_LIST: "/api/sessions/list" }),
}));

vi.mock("../../../../src/app/store", () => ({
    persistor: { purge: () => mockPurge() },
}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, opts?: any) => {
            const map: Record<string, string> = {
                "auth.migration.title": "Import Previous Data?",
                "auth.migration.description": `You have ${opts?.count ?? 0} workspace(s).`,
                "auth.migration.importButton": "Import Data",
                "auth.migration.freshButton": "Start Fresh",
                "auth.migration.importing": "Importing workspaces…",
                "auth.migration.success": `Imported ${opts?.count ?? 0} workspace(s).`,
                "auth.migration.failed": `Failed: ${opts?.message ?? ""}`,
            };
            return map[key] ?? key;
        },
    }),
}));

import { IdentityMigrationDialog } from "../../../../src/app/IdentityMigrationDialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: any, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function setupAnonymousWorkspaces(count: number) {
    mockFetchWithIdentity.mockImplementation(async (url: string) => {
        if (url.includes("/api/sessions/list")) {
            return jsonResponse({
                status: "ok",
                sessions: Array.from({ length: count }, (_, i) => ({ id: `ws-${i}` })),
            });
        }
        return jsonResponse({ status: "ok" });
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Prevent actual navigation
    Object.defineProperty(window, "location", {
        writable: true,
        value: { href: "/" },
    });
});

describe("Anonymous user logs in and sees migration dialog", () => {

    it("shows the dialog when anonymous workspaces exist", async () => {
        setupAnonymousWorkspaces(3);
        const onDone = vi.fn();

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={onDone} />);

        await waitFor(() => {
            expect(screen.getByText("Import Previous Data?")).toBeInTheDocument();
        });
        expect(screen.getByText(/You have 3 workspace/)).toBeInTheDocument();
        expect(screen.getByText("Import Data")).toBeInTheDocument();
        expect(screen.getByText("Start Fresh")).toBeInTheDocument();
    });

    it("auto-closes when no anonymous workspaces exist", async () => {
        setupAnonymousWorkspaces(0);
        const onDone = vi.fn();

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={onDone} />);

        await waitFor(() => {
            expect(onDone).toHaveBeenCalled();
        });
    });
});

describe("User clicks 'Start Fresh'", () => {

    it("does NOT call cleanup-anonymous (anonymous data preserved)", async () => {
        setupAnonymousWorkspaces(2);

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText("Start Fresh")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Start Fresh"));
        });

        const calls = mockFetchWithIdentity.mock.calls.map((c: any[]) => c[0]);
        expect(calls).not.toContainEqual(
            expect.stringContaining("cleanup-anonymous"),
        );
    });

    it("does NOT call migrate endpoint", async () => {
        setupAnonymousWorkspaces(2);

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText("Start Fresh")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Start Fresh"));
        });

        const calls = mockFetchWithIdentity.mock.calls.map((c: any[]) => c[0]);
        expect(calls).not.toContainEqual(
            expect.stringContaining("/api/sessions/migrate"),
        );
    });

    it("never shows 'Importing workspaces…' text", async () => {
        setupAnonymousWorkspaces(2);

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText("Start Fresh")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Start Fresh"));
        });

        expect(screen.queryByText("Importing workspaces…")).not.toBeInTheDocument();
    });

    it("navigates to home page", async () => {
        setupAnonymousWorkspaces(2);

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText("Start Fresh")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Start Fresh"));
        });

        await waitFor(() => {
            expect(window.location.href).toBe("/");
        });
    });
});

describe("User clicks 'Import Data'", () => {

    it("calls migrate endpoint and shows importing state", async () => {
        setupAnonymousWorkspaces(2);
        let resolveMigrate!: (v: Response) => void;
        mockFetchWithIdentity.mockImplementation(async (url: string) => {
            if (url.includes("/api/sessions/list")) {
                return jsonResponse({
                    status: "ok",
                    sessions: [{ id: "ws-0" }, { id: "ws-1" }],
                });
            }
            if (url.includes("/api/sessions/migrate")) {
                return new Promise<Response>((resolve) => {
                    resolveMigrate = resolve;
                });
            }
            return jsonResponse({ status: "ok" });
        });

        render(<IdentityMigrationDialog oldBrowserId="abc-123" onDone={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText("Import Data")).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText("Import Data"));
        });

        await waitFor(() => {
            expect(screen.getByText("Importing workspaces…")).toBeInTheDocument();
        });

        await act(async () => {
            resolveMigrate(jsonResponse({ status: "ok", moved: ["ws-0", "ws-1"] }));
        });

        await waitFor(() => {
            expect(screen.getByText(/Imported 2 workspace/)).toBeInTheDocument();
        });
    });
});
