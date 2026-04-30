// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Prompts the user to import anonymous workspace data after SSO login.
 *
 * Shown when the persisted Redux identity was `browser:<uuid>` but the
 * newly resolved identity is `user:<sub>`.  Checks whether the old
 * anonymous identity has workspaces on the server and, if so, offers
 * to move them into the authenticated user's workspace root.
 *
 * "Import" migrates anonymous workspaces into the authenticated user's
 * root.  "Start Fresh" simply switches identity without touching the
 * anonymous data — it remains on the server for future anonymous sessions.
 */

import { FC, useEffect, useState, useCallback } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    CircularProgress,
    Alert,
    Box,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { getUrls } from "./utils";
import { apiRequest } from "./apiClient";
import { persistor } from "./store";

export interface MigrationDialogProps {
    oldBrowserId: string;
    onDone: () => void;
}

export const IdentityMigrationDialog: FC<MigrationDialogProps> = ({
    oldBrowserId,
    onDone,
}) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(true);
    const [migrating, setMigrating] = useState(false);
    const [workspaceCount, setWorkspaceCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const sourceIdentity = `browser:${oldBrowserId}`;

    useEffect(() => {
        (async () => {
            try {
                const { data } = await apiRequest<{ sessions?: any[] }>(
                    `${getUrls().SESSION_LIST}?source_identity=${encodeURIComponent(sourceIdentity)}`,
                );
                const count = data.sessions?.length ?? 0;
                setWorkspaceCount(count);
                if (count === 0) {
                    onDone();
                }
            } catch {
                onDone();
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const cleanupAnonymous = useCallback(async () => {
        await apiRequest("/api/sessions/cleanup-anonymous", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_identity: sourceIdentity }),
        });
    }, [sourceIdentity]);

    const finishMigration = useCallback(async () => {
        localStorage.setItem('df_identity_type', 'user');
        await persistor.purge();
        window.location.href = "/";
    }, []);

    const handleImport = useCallback(async () => {
        setMigrating(true);
        setError(null);
        try {
            const { data } = await apiRequest<{ moved?: any[] }>("/api/sessions/migrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source_identity: sourceIdentity }),
            });
            const count = data.moved?.length ?? 0;
            setSuccess(t("auth.migration.success", { count }));
            // Cleanup is best-effort; migrate already moved/deleted data
            try { await cleanupAnonymous(); } catch { /* ignore */ }
            setTimeout(finishMigration, 1200);
        } catch (err: any) {
            setError(err?.message || "Network error");
            setMigrating(false);
        }
    }, [sourceIdentity, t, cleanupAnonymous, finishMigration]);

    const handleFresh = useCallback(async () => {
        await finishMigration();
    }, [finishMigration]);

    if (loading || workspaceCount === 0) {
        return null;
    }

    return (
        <Dialog open maxWidth="xs" fullWidth>
            <DialogTitle>{t("auth.migration.title")}</DialogTitle>
            <DialogContent>
                {success ? (
                    <Alert severity="success">{success}</Alert>
                ) : error ? (
                    <>
                        <Alert severity="error" sx={{ mb: 2 }}>
                            {t("auth.migration.failed", { message: error })}
                        </Alert>
                        <Typography variant="body2">
                            {t("auth.migration.description", { count: workspaceCount })}
                        </Typography>
                    </>
                ) : migrating ? (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
                        <CircularProgress size={20} />
                        <Typography variant="body2">{t("auth.migration.importing")}</Typography>
                    </Box>
                ) : (
                    <Typography variant="body2">
                        {t("auth.migration.description", { count: workspaceCount })}
                    </Typography>
                )}
            </DialogContent>
            {!success && (
                <DialogActions>
                    <Button onClick={handleFresh} disabled={migrating}>
                        {t("auth.migration.freshButton")}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleImport}
                        disabled={migrating}
                    >
                        {t("auth.migration.importButton")}
                    </Button>
                </DialogActions>
            )}
        </Dialog>
    );
};
