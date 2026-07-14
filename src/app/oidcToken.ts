import type { User } from 'oidc-client-ts';

export interface OidcTokenManager {
    getUser(): Promise<User | null>;
    signinSilent(): Promise<User | null>;
}

export async function getAccessTokenFromManager(
    manager: OidcTokenManager | null,
): Promise<string | null> {
    if (!manager) return null;

    let user = await manager.getUser();
    if (!user) return null;

    if (user.expired) {
        try {
            user = await manager.signinSilent();
        } catch {
            return null;
        }
        if (!user) return null;
    }

    return user.access_token;
}
