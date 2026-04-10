// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Prompts the user to import anonymous workspace data after SSO login.
 *
 * Shown when the persisted Redux identity was `browser:<uuid>` but the
 * newly resolved identity is `user:<sub>`.  Checks whether the old
 * anonymous identity has workspaces on the server and, if so, offers
 * to copy them into the authenticated user's workspace root.
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
import { fetchWithIdentity, getUrls } from "./utils";
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
                const res = await fetchWithIdentity(
                    `${getUrls().SESSION_LIST}?source_identity=${encodeURIComponent(sourceIdentity)}`,
                );
                const data = await res.json();
                const count = data.status === "ok" ? (data.sessions?.length ?? 0) : 0;
                setWorkspaceCount(count);
                if (count === 0) {
                    await purgeAndFinish();
                }
            } catch {
                await purgeAndFinish();
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const purgeAndFinish = useCallback(async () => {
        await persistor.purge();
        onDone();
    }, [onDone]);

    const handleImport = useCallback(async () => {
        setMigrating(true);
        setError(null);
        try {
            const res = await fetchWithIdentity("/api/sessions/migrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source_identity: sourceIdentity }),
            });
            const data = await res.json();
            if (data.status === "ok") {
                const count = data.copied?.length ?? 0;
                setSuccess(t("auth.migration.success", { count }));
                setTimeout(async () => {
                    await persistor.purge();
                    window.location.href = "/";
                }, 1200);
            } else {
                setError(data.message || "Unknown error");
                setMigrating(false);
            }
        } catch (err: any) {
            setError(err?.message || "Network error");
            setMigrating(false);
        }
    }, [sourceIdentity, t]);

    const handleFresh = useCallback(async () => {
        await purgeAndFinish();
        window.location.href = "/";
    }, [purgeAndFinish]);

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
