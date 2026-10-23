// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ReactNode } from 'react';

/** An example analysis of a starter's data: a saved session answering its prompt, or run live without one. */
export interface SiteStory {
    id: string;
    /** A short name for the story's tab, e.g. "The wealth gap". */
    label?: string;
    headline: string;
    dek?: string;
    /** The dataset's lead story, shown large. */
    featured?: boolean;
    /** The story's question: answered in its saved session, or asked live when there is none. Shown on the page. */
    prompt: string;
    /** Questions offered for continuing the analysis once it is open. */
    follow_ups?: string[];
    /** True when the story's saved session is installed; opening it then needs no analyst run. */
    available: boolean;
    /** URL of the story's saved session ZIP. */
    session: string;
    /** URL of the cover image, if there is one. */
    image?: string | null;
    /** A few of the story's findings, each a chart image with a short label, shown as a stack of cards. */
    stack?: { label: string; image: string }[];
}

/** A dataset on the site's front page, with a starter session (see demos/README.md). */
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
    /** A short name for the dataset, e.g. "SDG 4 education", used where the title is too long. */
    kicker?: string;
    /** The dataset's page at its source, linked from its section. */
    source_url?: string;
    /** The quick link's icon: 'school', 'science', 'landmark', 'chart' or 'table' (the default). */
    icon?: string;
    /** A line on the new-session card about what it starts from; defaults to "Start from the full dataset". */
    start_note?: string;
    stories?: SiteStory[];
}

export interface SiteConfig {
    id: string;
    name: string;
    /** The front page's title, when it should say more than the site's name. */
    headline?: string;
    /** A small label beside the title, e.g. "Beta". */
    badge?: string;
    tagline?: string;
    /** Short points on what the site is built from, shown as bullets before the intro; [text](url) is a link. */
    about?: string[];
    intro?: string;
    release?: string;
    /** URL of a picture of the app at work, for the front page; null until the image is in the content folder. */
    hero_image?: string | null;
    attribution?: string;
    /** A note after "Powered by Data Formulator" at the foot of the page; [text](url) is a link. */
    disclaimer?: string;
    links?: { label: string; url: string }[];
    starters: SiteStarter[];
    /** "ready" once the demo's content is installed on this server. */
    status?: 'ready' | 'not_installed';
    /** Whether the page may install the demo's content (local installs). */
    can_install?: boolean;
    /** What installing the demo downloads and builds, shown before it is installed. */
    install_note?: string;
}

export interface SiteLandingProps {
    site: SiteConfig;
    /** Opens a starter session; with a question, asks it once the session is open. */
    onOpenStarter: (starter: SiteStarter, question?: string) => void;
    /** Opens a story's pre-made session (or, before it is built, its first question on the starter). */
    onOpenStory: (starter: SiteStarter, story: SiteStory) => void;
    /** The visitor's saved sessions on this site, already rendered. */
    sessions?: ReactNode;
    footer?: ReactNode;
    disabled?: boolean;
}
