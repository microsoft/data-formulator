// src/Msal/MicrosoftLoginButton.tsx
import React, { useEffect } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig, loginRequest } from "./msalConfig";

let msalInstance: PublicClientApplication | null = null;
function getMsalInstance(): PublicClientApplication | null {
  if (msalInstance) return msalInstance;
  if (
    typeof window !== "undefined" &&
    (window.isSecureContext || window.location.hostname === "localhost")
  ) {
    try {
      msalInstance = new PublicClientApplication(msalConfig);
    } catch (err) {
      console.error("MSAL init error:", err);
      msalInstance = null;
    }
  } else {
    console.warn(
      "MSAL not initialized: insecure context or crypto unavailable",
    );
    msalInstance = null;
  }
  return msalInstance;
}

const MicrosoftLoginButton: React.FC = () => {
  useEffect(() => {
    const instance = getMsalInstance();
    instance
      ?.initialize()
      .catch((err) => console.error("MSAL init error:", err));
  }, []);

  const login = async () => {
    try {
      const instance = getMsalInstance();
      if (!instance) {
        alert("Microsoft auth is not available in this environment.");
        return;
      }
      // ✅ Microsoft login
      const loginResponse = await instance.loginPopup({
        scopes: ["openid", "profile", "email"],
      });
      const idToken = loginResponse.idToken;
      const claims = loginResponse.account.idTokenClaims;

      if (!claims) {
        alert("Your Microsoft account not found!");
        return;
      }

      // ✅ Get email + name from Microsoft
      const email = claims?.email;
      const username = claims?.name || claims?.email;
      // ✅ Send email + username to backend for permission check
      const apiResponse = await fetch("/api/auth/microsoft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, username, idToken }),
      });

      if (apiResponse.status === 403) {
        const json = await apiResponse.json();
        alert(`❌ ${json.message}`);
        return;
      }

      if (!apiResponse.ok) {
        throw new Error("Backend Microsoft authentication failed");
      }

      // ✅ Nếu backend OK → redirect
      window.location.href = "/";
    } catch (error) {
      console.error("Microsoft login failed:", error);
      alert("Microsoft login failed. Check console logs.");
    }
  };

  return (
    <button
      onClick={login}
      style={{
        padding: "10px 15px",
        background: "#2F2F2F",
        color: "white",
        border: "none",
        borderRadius: 4,
        cursor: "pointer",
        width: "100%",
        marginTop: "10px",
      }}
    >
      🔑 Sign in with Microsoft
    </button>
  );
};

export default MicrosoftLoginButton;
