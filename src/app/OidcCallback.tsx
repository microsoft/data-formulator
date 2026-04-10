// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * OIDC redirect callback page.
 *
 * The Identity Provider redirects here after the user authenticates.
 * We hand the URL (containing the authorization code) to `oidc-client-ts`
 * which exchanges it for tokens, then navigate to the app root.
 */

import { useEffect, useState } from "react";
import {
    Box,
    CircularProgress,
    Typography,
    Alert,
    Paper,
    alpha,
    useTheme,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { getUserManager } from "./oidcConfig";
import dfLogo from "../assets/df-logo.png";

export function OidcCallback() {
    const { t } = useTranslation();
    const theme = useTheme();
    const [error, setError] = useState<string | null>(null);
    const [redirecting, setRedirecting] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const mgr = await getUserManager();
                if (!mgr) return;

                const params = new URLSearchParams(window.location.search);
                if (!params.get("state") && params.get("code")) {
                    // IdP-initiated flow: the SSO redirected here directly
                    // without DF having started the login.  Re-initiate a
                    // standard SP flow — since the user is already
                    // authenticated at the IdP, the redirect is transparent.
                    setRedirecting(true);
                    await mgr.signinRedirect();
                    return;
                }

                await mgr.signinRedirectCallback();
                window.location.href = "/";
            } catch (err: any) {
                setError(err?.message || "Unknown error");
            }
        })();
    }, []);

    return (
        <Box
            sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "100vw",
                height: "100vh",
                background: `
                    linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                    linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
                `,
                backgroundSize: "16px 16px",
            }}
        >
            <Paper
                elevation={0}
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    maxWidth: 420,
                    width: "100%",
                    mx: 2,
                    p: 5,
                    border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
                    borderRadius: 2,
                }}
            >
                <Box
                    component="img"
                    sx={{ height: 28, mb: 2 }}
                    alt=""
                    src={dfLogo}
                />
                {error ? (
                    <Alert severity="error" sx={{ width: "100%" }}>
                        {t("auth.callbackFailed", { message: error })}
                    </Alert>
                ) : (
                    <>
                        <CircularProgress size={24} sx={{ mb: 2 }} />
                        <Typography
                            variant="body2"
                            sx={{ color: "text.secondary" }}
                        >
                            {redirecting
                                ? t("auth.idpRedirecting")
                                : t("auth.completingLogin")}
                        </Typography>
                    </>
                )}
            </Paper>
        </Box>
    );
}
