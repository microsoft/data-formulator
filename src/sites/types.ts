// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ReactNode } from 'react';

/** A specialized front page selected by the server from the hostname (py-src/data_formulator/sites). */
export interface SiteStarter {
    id: string;
    title: string;
    subtitle?: string;
    description?: string;
    questions: string[];
    /** False until the starter-session ZIP has been built into the site's content folder. */
    available: boolean;
    /** URL of the starter-session ZIP. */
    workspace: string;
}

export interface SiteConfig {
    id: string;
    name: string;
    tagline?: string;
    intro?: string;
    release?: string;
    attribution?: string;
    links?: { label: string; url: string }[];
    starters: SiteStarter[];
}

export interface SiteLandingProps {
    site: SiteConfig;
    /** Opens a starter session; with a question, asks it once the session is open. */
    onOpenStarter: (starter: SiteStarter, question?: string) => void;
    /** The visitor's saved sessions on this site, already rendered. */
    sessions?: ReactNode;
    footer?: ReactNode;
    disabled?: boolean;
}
