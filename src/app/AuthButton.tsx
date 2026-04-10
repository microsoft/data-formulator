// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Sign-in / sign-out button rendered in the AppBar.
 *
 * Behaviour depends on the current identity state:
 * - Authenticated (`user:*`)  → show display name + sign-out icon
 * - Anonymous with OIDC active → show "Sign In" button
 * - Anonymous without OIDC     → render nothing
 */

import { FC, useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Box, Button, IconButton, Tooltip, Typography } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import LoginIcon from "@mui/icons-material/Login";
import { useTranslation } from "react-i18next";
import type { UserManager } from "oidc-client-ts";
import type { DataFormulatorState } from "./dfSlice";
import { getUserManager } from "./oidcConfig";
import { persistor } from "./store";

export const AuthButton: FC = () => {
    const { t } = useTranslation();
    const identity = useSelector((s: DataFormulatorState) => s.identity);
    const [mgr, setMgr] = useState<UserManager | null>(null);

    useEffect(() => {
        getUserManager().then(setMgr);
    }, []);

    const handleSignOut = useCallback(async () => {
        if (!mgr) return;
        try {
            // Try IdP-initiated logout if end_session_endpoint is available
            await mgr.signoutRedirect();
        } catch {
            // IdP has no end_session_endpoint — do a local sign-out instead
            await mgr.removeUser();
            await persistor.purge();
            window.location.href = "/";
        }
    }, [mgr]);

    if (identity?.type === "user") {
        const label = identity.displayName || identity.id;
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 1 }}>
                <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.85 }}>
                    {label}
                </Typography>
                {mgr && (
                    <Tooltip title={t("auth.signOut")}>
                        <IconButton
                            size="small"
                            onClick={handleSignOut}
                            sx={{ color: "inherit" }}
                        >
                            <LogoutIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
        );
    }

    if (mgr) {
        return (
            <Tooltip title={t("auth.ssoDescription")}>
                <Button
                    variant="text"
                    size="small"
                    startIcon={<LoginIcon sx={{ fontSize: 16 }} />}
                    onClick={() => mgr.signinRedirect()}
                    sx={{
                        ml: 1,
                        textTransform: "none",
                        color: "inherit",
                        fontSize: 12,
                    }}
                >
                    {t("auth.ssoLogin")}
                </Button>
            </Tooltip>
        );
    }

    return null;
};
