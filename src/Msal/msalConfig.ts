// src/Msal/msalConfig.ts
import { Configuration } from "@azure/msal-browser";

export const msalConfig: Configuration = {
    auth: {
        clientId: "56f3a04a-a919-4917-ae57-f7442b2a271b", // 👈 Thay bằng Client ID trong Azure AD
        authority: "https://login.microsoftonline.com/bf781f77-403a-41b0-bc8d-aef742fcc54e",
    redirectUri: import.meta.env.VITE_REDIRECT_URI || "http://localhost:5173",
    },
    cache: {
        cacheLocation: "localStorage",
        storeAuthStateInCookie: false,
    }
};

export const loginRequest = {
    scopes: ["User.Read"]
};
