// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Box, Typography, Button, useTheme, alpha, Divider } from "@mui/material";
import { borderColor, radius } from '../app/tokens';
import React, { FC } from "react";
import GridViewIcon from '@mui/icons-material/GridView';
import GitHubIcon from '@mui/icons-material/GitHub';
import YouTubeIcon from '@mui/icons-material/YouTube';
import { AgentIcon as PrecisionManufacturingIcon } from '../icons';

import { toolName } from "../app/App";
import { useSelector } from "react-redux";
import { DataFormulatorState } from "../app/dfSlice";


interface Feature {
    title: string;
    description: string;
    media: string;
    mediaType: 'image' | 'video';
}

const features: Feature[] = [
    {
        title: "Load (Almost) Any Data",
        description: "Load structured data, connect to databases. Ask AI agents to extract and clean (small) ad-hoc data from screenshots, text blocks.",
        media: "/feature-extract-data.mp4",
        mediaType: "video"
    },
    {
        title: "Agent Mode",
        description: "Vibe with your data. Hands-off and let agents automatically explore and visualize data from high-level goals.",
        media: "/feature-agent-mode.mp4",
        mediaType: "video"
    },
    {
        title: "Interactive Control",
        description: "Use UI interactions and natural language to precisely describe chart designs. Ask AI agents for recommendations. Use Data Threads to backtrack, explore new branches, or follow up.",
        media: "/feature-interactive-control.mp4",
        mediaType: "video"
    },
    {
        title: "Verify & Share Insights",
        description: "Interact with charts, inspect data, formulas, and code. Create reports to share insights grounded in your exploration.",
        media: "/feature-generate-report.mp4",
        mediaType: "video"
    }
];

export const About: FC<{}> = function About({ }) {
    const theme = useTheme();

    let actionButtons = (
        <Box component="nav" aria-label="Primary actions" sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, mb: 4, flexWrap: 'wrap' }}>
            <Button size="large" variant="outlined" color="primary" 
                sx={{ textTransform: 'none' }}
                startIcon={<Box component="img" sx={{ width: 20, height: 20 }} alt="" aria-hidden="true" src="/pip-logo.svg" />}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Install Locally via pip (opens in new tab)"
                href="https://pypi.org/project/data-formulator/"
            >Install Locally</Button>
            <Button size="large" variant="contained" color="primary" 
                sx={{ textTransform: 'none' }}
                startIcon={<GridViewIcon aria-hidden="true" />}
                href="/app"
            >Try Online Demo</Button>
            <Button size="large" variant="outlined" color="primary" 
                sx={{ textTransform: 'none' }}
                startIcon={<YouTubeIcon sx={{ color: '#FF0000' }} aria-hidden="true" />}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Watch Video on YouTube (opens in new tab)"
                href="https://www.youtube.com/watch?v=GfTE2FLyMrs"
            >Video</Button>
            <Button size="large" variant="outlined" color="primary" 
                sx={{ textTransform: 'none' }}
                startIcon={<GitHubIcon aria-hidden="true" />}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View on GitHub (opens in new tab)"
                href="https://github.com/microsoft/data-formulator"
            >GitHub</Button>
        </Box>
    );

    return (
        <Box 
            component="main"
            role="main"
            sx={{
                display: "flex", 
                flexDirection: "column", 
                overflowY: "auto",
                width: '100%',
                height: '100%',
                background: `
                    linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                    linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
                `,
                backgroundSize: '16px 16px',
            }}
        >
            <Box sx={{margin:'auto', py: 4, display: "flex", flexDirection: "column", textAlign: "center", maxWidth: 1000, width: '100%', px: 3}}>
                {/* Header with title */}
                <Box component="header" sx={{display: 'flex', flexDirection: 'column', mx: 'auto', mt: 2}}>
                    <Typography component="h1" fontSize={84} sx={{letterSpacing: '0.05em'}}>{toolName}</Typography> 
                    <Typography component="p" sx={{ 
                        fontSize: 24, color: theme.palette.text.secondary, 
                        textAlign: 'center', mb: 4}}>
                        Explore data with visualizations, powered by AI agents. 
                    </Typography>
                </Box>
                
                {actionButtons}

                {/* Features Grid - 2 columns, 4 rows */}
                <Box 
                    component="section" 
                    aria-label="Features"
                    sx={{ display: 'flex', flexDirection: 'column', gap: 5, mt: 2 }}
                >
                    {features.map((feature, index) => (
                        <Box 
                            component="article"
                            key={index}
                            aria-labelledby={`feature-title-${index}`}
                            sx={{ 
                                display: 'flex', 
                                flexDirection: index % 2 === 0 ? 'row' : 'row-reverse',
                                gap: 4,
                                alignItems: 'center',
                            }}
                        >
                            {/* Text Content */}
                            <Box sx={{ 
                                flex: 1,
                                textAlign: index % 2 === 0 ? 'left' : 'right',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                            }}>
                                <Typography 
                                    component="h2"
                                    id={`feature-title-${index}`}
                                    sx={{ 
                                        fontSize: 28,
                                        fontWeight: 500,
                                        mb: 1.5,
                                        color: theme.palette.text.primary,
                                    }}
                                >
                                    {feature.title}
                                </Typography>
                                <Typography 
                                    component="p"
                                    sx={{ 
                                        fontSize: 17,
                                        color: 'text.secondary', 
                                        lineHeight: 1.7,
                                    }}
                                >
                                    {feature.description}
                                </Typography>
                            </Box>

                            {/* Media Content */}
                            <Box sx={{ 
                                flex: 1,
                                borderRadius: radius.md,
                                overflow: 'hidden',
                                border: `1px solid ${borderColor.divider}`,
                            }}>
                                {feature.mediaType === 'video' ? (
                                    <Box
                                        component="video"
                                        src={feature.media}
                                        autoPlay
                                        loop
                                        muted
                                        playsInline
                                        preload="metadata"
                                        aria-label={`Video demonstration: ${feature.title}`}
                                        sx={{
                                            width: '100%',
                                            height: 'auto',
                                            display: 'block',
                                        }}
                                    />
                                ) : (
                                    <Box
                                        component="img"
                                        src={feature.media}
                                        alt={feature.title}
                                        loading="lazy"
                                        sx={{
                                            width: '100%',
                                            height: 'auto',
                                            display: 'block',
                                        }}
                                    />
                                )}
                            </Box>
                        </Box>
                    ))}
                </Box>

                <Box sx={{ mt: 6, mx: 2 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        <strong>Data handling:</strong> Data stored in browser only • Local install runs Python locally; online demo processes server-side (not stored) • LLM receives small samples with prompts
                    </Typography>
                    <Typography variant="body2" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                        Research Prototype from Microsoft Research
                    </Typography>
                </Box>
            </Box>

            {/* Footer */}
            <Box 
                component="footer"
                role="contentinfo"
                sx={{ color: 'text.secondary', display: 'flex', 
                    backgroundColor: 'rgba(255, 255, 255, 0.89)',
                    alignItems: 'center', justifyContent: 'center' }}
            >
                <Button size="small" color="inherit" 
                        sx={{ textTransform: 'none' }} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        aria-label="Privacy & Cookies (opens in new tab)"
                        href="https://www.microsoft.com/en-us/privacy/privacystatement">Privacy & Cookies</Button>
                <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} aria-hidden="true" />
                <Button size="small" color="inherit" 
                        sx={{ textTransform: 'none' }} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        aria-label="Terms of Use (opens in new tab)"
                        href="https://www.microsoft.com/en-us/legal/intellectualproperty/copyright">Terms of Use</Button>
                <Divider orientation="vertical" variant="middle" flexItem sx={{ mx: 1 }} aria-hidden="true" />
                <Button size="small" color="inherit" 
                        sx={{ textTransform: 'none' }} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        aria-label="Contact Us (opens in new tab)"
                        href="https://github.com/microsoft/data-formulator/issues">Contact Us</Button>
                <Typography component="span" sx={{ fontSize: '12px', ml: 1 }}>© {new Date().getFullYear()}</Typography>
            </Box>
        </Box>)
}
