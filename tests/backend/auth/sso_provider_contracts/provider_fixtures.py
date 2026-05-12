"""Reusable provider contracts for no-Docker SSO tests.

The fixtures model public metadata and common claims from mainstream providers
without contacting the real services.
"""
from __future__ import annotations

CLIENT_ID = "df-contract-client"
CLIENT_SECRET = "df-contract-secret"


OIDC_PROVIDER_CONTRACTS = [
    {
        "id": "apple",
        "display_name": "Sign in with Apple",
        "issuer": "https://appleid.apple.com",
        "authorize_url": "https://appleid.apple.com/auth/authorize",
        "token_url": "https://appleid.apple.com/auth/token",
        "userinfo_url": "",
        "jwks_url": "https://appleid.apple.com/auth/keys",
        "subject": "apple-subject-123",
        "claims": {
            "name": "Alice Apple",
            "email": "alice@privaterelay.appleid.com",
            "email_verified": True,
            "is_private_email": True,
        },
    },
    {
        "id": "microsoft_entra_id",
        "display_name": "Microsoft Entra ID",
        "issuer": "https://login.microsoftonline.com/common/v2.0",
        "authorize_url": (
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
        ),
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "userinfo_url": "https://graph.microsoft.com/oidc/userinfo",
        "jwks_url": (
            "https://login.microsoftonline.com/common/discovery/v2.0/keys"
        ),
        "subject": "microsoft-subject-123",
        "claims": {
            "oid": "00000000-0000-0000-0000-000000000123",
            "tid": "11111111-1111-1111-1111-111111111111",
            "preferred_username": "alice@contoso.example",
            "name": "Alice Entra",
            "email": "alice@contoso.example",
        },
    },
    {
        "id": "google",
        "display_name": "Google",
        "issuer": "https://accounts.google.com",
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "jwks_url": "https://www.googleapis.com/oauth2/v3/certs",
        "subject": "google-subject-123",
        "audience": [CLIENT_ID, "secondary-google-client"],
        "claims": {
            "azp": CLIENT_ID,
            "name": "Alice Google",
            "email": "alice@gmail.example",
            "email_verified": True,
            "hd": "example.com",
        },
    },
    {
        "id": "gitlab",
        "display_name": "GitLab",
        "issuer": "https://gitlab.com",
        "authorize_url": "https://gitlab.com/oauth/authorize",
        "token_url": "https://gitlab.com/oauth/token",
        "userinfo_url": "https://gitlab.com/oauth/userinfo",
        "jwks_url": "https://gitlab.com/oauth/discovery/keys",
        "subject": "gitlab-subject-123",
        "claims": {
            "nickname": "alice",
            "preferred_username": "alice",
            "name": "Alice GitLab",
            "email": "alice@gitlab.example",
            "email_verified": True,
            "groups_direct": ["data/formulator"],
            "https://gitlab.org/claims/groups/developer": ["data/formulator"],
        },
    },
    {
        "id": "keycloak",
        "display_name": "Keycloak",
        "issuer": "https://keycloak.example.com/realms/data-formulator",
        "authorize_url": (
            "https://keycloak.example.com/realms/data-formulator/"
            "protocol/openid-connect/auth"
        ),
        "token_url": (
            "https://keycloak.example.com/realms/data-formulator/"
            "protocol/openid-connect/token"
        ),
        "userinfo_url": (
            "https://keycloak.example.com/realms/data-formulator/"
            "protocol/openid-connect/userinfo"
        ),
        "jwks_url": (
            "https://keycloak.example.com/realms/data-formulator/"
            "protocol/openid-connect/certs"
        ),
        "subject": "keycloak-subject-123",
        "claims": {
            "preferred_username": "alice",
            "name": "Alice Keycloak",
            "email": "alice@keycloak.example",
            "realm_access": {"roles": ["analyst"]},
        },
    },
    {
        "id": "okta",
        "display_name": "Okta",
        "issuer": "https://dev-123456.okta.com/oauth2/default",
        "authorize_url": (
            "https://dev-123456.okta.com/oauth2/default/v1/authorize"
        ),
        "token_url": "https://dev-123456.okta.com/oauth2/default/v1/token",
        "userinfo_url": (
            "https://dev-123456.okta.com/oauth2/default/v1/userinfo"
        ),
        "jwks_url": "https://dev-123456.okta.com/oauth2/default/v1/keys",
        "subject": "okta-subject-123",
        "claims": {
            "preferred_username": "alice@okta.example",
            "name": "Alice Okta",
            "email": "alice@okta.example",
            "groups": ["analysts", "admins"],
        },
    },
    {
        "id": "auth0",
        "display_name": "Auth0",
        "issuer": "https://df-test.us.auth0.com/",
        "authorize_url": "https://df-test.us.auth0.com/authorize",
        "token_url": "https://df-test.us.auth0.com/oauth/token",
        "userinfo_url": "https://df-test.us.auth0.com/userinfo",
        "jwks_url": "https://df-test.us.auth0.com/.well-known/jwks.json",
        "subject": "auth0|contract-user-123",
        "claims": {
            "nickname": "alice-auth0",
            "name": "Alice Auth0",
            "email": "alice@auth0.example",
            "https://data-formulator.example/roles": ["analyst"],
        },
    },
    {
        "id": "alibaba_cloud_idaas",
        "display_name": "Alibaba Cloud IDaaS",
        "issuer": "https://contract.aliyunidaas.com/oidc",
        "authorize_url": "https://contract.aliyunidaas.com/oidc/authorize",
        "token_url": "https://contract.aliyunidaas.com/oauth2/token",
        "userinfo_url": "https://contract.aliyunidaas.com/oidc1/userinfo",
        "jwks_url": "https://contract.aliyunidaas.com/oidc1/keys",
        "subject": "alibaba-idaas-subject-123",
        "claims": {
            "name": "Alice Alibaba IDaaS",
            "email": "alice@alibaba-idaas.example",
            "phone_number": "+8613800000000",
            "profile": "alice",
        },
    },
    {
        "id": "aws_cognito",
        "display_name": "AWS Cognito",
        "issuer": (
            "https://cognito-idp.us-east-1.amazonaws.com/"
            "us-east-1_contractpool"
        ),
        "authorize_url": (
            "https://contract-domain.auth.us-east-1.amazoncognito.com/"
            "oauth2/authorize"
        ),
        "token_url": (
            "https://contract-domain.auth.us-east-1.amazoncognito.com/"
            "oauth2/token"
        ),
        "userinfo_url": (
            "https://contract-domain.auth.us-east-1.amazoncognito.com/"
            "oauth2/userInfo"
        ),
        "jwks_url": (
            "https://cognito-idp.us-east-1.amazonaws.com/"
            "us-east-1_contractpool/.well-known/jwks.json"
        ),
        "subject": "aws-cognito-subject-123",
        "claims": {
            "cognito:username": "alice",
            "name": "Alice Cognito",
            "email": "alice@cognito.example",
            "token_use": "id",
        },
        "access_token_claims": {
            "client_id": CLIENT_ID,
            "scope": "openid profile email",
            "token_use": "access",
        },
    },
    {
        "id": "tencent_cloud_idaas",
        "display_name": "Tencent Cloud IDaaS",
        "issuer": "https://identity.tencent.example.com/oauth2",
        "authorize_url": "https://identity.tencent.example.com/oauth2/authorize",
        "token_url": "https://identity.tencent.example.com/oauth2/token",
        "userinfo_url": "https://identity.tencent.example.com/userinfo",
        "jwks_url": "https://identity.tencent.example.com/oauth2/jwks",
        "subject": "tencent-idaas-subject-123",
        "claims": {
            "preferred_username": "alice",
            "nickname": "Alice",
            "name": "Alice Tencent IDaaS",
            "email": "alice@tencent-idaas.example",
            "phone_number": "+8613900000000",
        },
    },
    {
        "id": "huawei_oneaccess",
        "display_name": "Huawei Cloud OneAccess",
        "issuer": "https://oneaccess.example.com",
        "authorize_url": "https://oneaccess.example.com/oauth2/authorize",
        "token_url": "https://oneaccess.example.com/oauth2/token",
        "userinfo_url": "https://oneaccess.example.com/api/v1/oauth2/userinfo",
        "jwks_url": "https://oneaccess.example.com/oauth2/jwks",
        "subject": "huawei-oneaccess-subject-123",
        "signing_algorithm": "RS512",
        "algorithms": ["RS512"],
        "claims": {
            "userName": "alice",
            "name": "Alice Huawei OneAccess",
            "email": "alice@huawei-oneaccess.example",
            "mobile": "+8613700000000",
        },
    },
]


GITHUB_OAUTH_CONTRACT = {
    "authorize_url": "https://github.com/login/oauth/authorize",
    "token_url": "https://github.com/login/oauth/access_token",
    "user_url": "https://api.github.com/user",
    "emails_url": "https://api.github.com/user/emails",
    "scope": "read:user user:email",
    "access_token": "gho_contract_token",
    "user": {
        "id": 12345678,
        "login": "octocat",
        "name": "The Octocat",
        "email": "octocat@github.example",
    },
}
