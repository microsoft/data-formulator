// src/Msal/MicrosoftLoginButton.tsx
import React, { useEffect } from "react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig, loginRequest } from "./msalConfig";

const msalInstance = new PublicClientApplication(msalConfig);

const MicrosoftLoginButton: React.FC = () => {
  useEffect(() => {
    msalInstance
      .initialize()
      .catch((err) => console.error("MSAL init error:", err));
  }, []);

  const login = async () => {
    try {
      // ✅ Đăng nhập Microsoft
      const loginResponse = await msalInstance.loginPopup(loginRequest);
      const account = loginResponse.account;

      if (!account) {
        alert("Không lấy được thông tin tài khoản Microsoft!");
        return;
      }

      // ✅ Lấy email + tên từ Microsoft
      const email = account.username;
      const username = account.name || account.username;
      // ✅ Gửi email + username sang backend để kiểm tra quyền
      const apiResponse = await fetch("/api/auth/microsoft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, username }),
      });

      if (apiResponse.status === 403) {
        alert("❌ Your account is not registered to use this application.");
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
