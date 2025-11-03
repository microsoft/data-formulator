// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Box, Typography, Button, Divider, useTheme, alpha, Link, IconButton, ButtonGroup, SvgIcon } from "@mui/material";
import React, { FC, useState } from "react";
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import YouTubeIcon from '@mui/icons-material/YouTube';
import GitHubIcon from '@mui/icons-material/GitHub';
import PublicIcon from '@mui/icons-material/Public';
import GridViewIcon from '@mui/icons-material/GridView';

import dfLogo from '../assets/df-logo.png';
import { toolName } from "../app/App";

// Discord Icon Component
const DiscordIcon: FC<{ sx?: any }> = ({ sx }) => (
    <SvgIcon sx={sx} viewBox="0 0 24 24">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z" fill="currentColor"/>
    </SvgIcon>
);

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
        media: "/extract-data.mp4",
        mediaType: "video"
    },
    {
        title: "Agent Mode",
        description: "Vibe with your data. Hands-off and let agents automatically explore and visualize data from high-level goals.",
        media: "/agent-mode.mp4",
        mediaType: "video"
    },
    {
        title: "Interactive Control",
        description: "Use UI interactions and natural language to precisely describe chart designs. Ask AI agents for recommendations. Use Data Threads to backtrack, explore new branches, or follow up.",
        media: "/data-formulator-screenshot-v0.5.png",
        mediaType: "image"
    },
    {
        title: "Verify & Share Insights",
        description: "Interact with charts, inspect data, formulas, and code. Create reports to share insights grounded in your exploration.",
        media: "/unemployment.png",
        mediaType: "image"
    }
];

export const About: FC<{}> = function About({ }) {
    const theme = useTheme();
    const [currentFeature, setCurrentFeature] = useState(0);

    const handlePrevious = () => {
        setCurrentFeature((prev) => (prev === 0 ? features.length - 1 : prev - 1));
    };

    const handleNext = () => {
        setCurrentFeature((prev) => (prev === features.length - 1 ? 0 : prev + 1));
    };

    return (
        <Box sx={{
            display: "flex", 
            flexDirection: "column", 
            textAlign: "center", 
            overflowY: "auto",
            width: '100%',
            height: '100%',
            background: `
                linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px),
                linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.01)} 1px, transparent 1px)
            `,
            backgroundSize: '16px 16px',
        }}>
            <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center", maxWidth: 1200}}>
                {/* Header with logo and title */}
                <Box sx={{
                    display: 'flex', 
                    mx: 'auto', 
                    my: 4,
                    width: 'fit-content', 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    background: `
                        linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                        linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                    `,
                    backgroundSize: '16px 16px',
                    p: 3,
                    borderRadius: '12px',
                }}>
                    <Box component="img" sx={{ width: 96 }} alt="" src={dfLogo} /> 
                    <Typography fontSize={72} sx={{
                        ml: 2, 
                        letterSpacing: '0.05em', 
                        fontWeight: 200, 
                        color: 'text.primary',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'baseline',
                    }}>
                        {toolName} <Typography fontSize={18} sx={{ color: 'text.secondary', ml: 1 }}>v0.5</Typography>
                    </Typography> 
                </Box>
                <Typography fontSize={18} sx={{mb: 2, color: 'text.secondary', lineHeight: 1.8}}>
                    Turn (almost) any data into insights with AI agents, with the exploration paths you choose. 
                </Typography>

                {/* Quick Action Buttons */}
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 4, flexWrap: 'wrap' }}>
                    <Button 
                        size="small"
                        variant="contained"
                        startIcon={<GridViewIcon sx={{ fontSize: '1rem' }} />}
                        href="/app"
                        sx={{ 
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            px: 1.5,
                            py: 0.5,
                           
                        }}
                    >
                        Start Exploring
                    </Button>
                    <Divider orientation="vertical" sx={{ mx: 1 }} />
                    <Button 
                        size="small"
                        variant="text"
                        startIcon={<YouTubeIcon sx={{ fontSize: '1rem', color: '#FF0000' }} />}
                        href="https://youtu.be/3ndlwt0Wi3c"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ 
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: alpha(theme.palette.text.secondary, 0.05)
                            }
                        }}
                    >
                        Watch Video
                    </Button>
                    <Button 
                        size="small"
                        variant="text"
                        startIcon={<GitHubIcon sx={{ fontSize: '1rem', color: '#181717' }} />}
                        href="https://github.com/microsoft/data-formulator"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ 
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: alpha(theme.palette.text.secondary, 0.05)
                            }
                        }}
                    >
                        Source
                    </Button>
                    <Button 
                        size="small"
                        variant="text"
                        startIcon={<Box component="img" src="/pip-logo.svg" sx={{ width: '1rem', height: '1rem' }} />}
                        href="https://pypi.org/project/data-formulator/"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ 
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: alpha(theme.palette.text.secondary, 0.05)
                            }
                        }}
                    >
                        Pip Install
                    </Button>
                    
                    <Button 
                        size="small"
                        variant="text"
                        startIcon={<DiscordIcon sx={{ fontSize: '1rem', color: '#5865F2' }} />}
                        href="https://discord.gg/mYCZMQKYZb"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={{ 
                            textTransform: 'none',
                            fontSize: '0.8rem',
                            px: 1.5,
                            py: 0.5,
                            color: 'text.secondary',
                            '&:hover': {
                                color: 'text.primary',
                                backgroundColor: alpha(theme.palette.text.secondary, 0.05)
                            }
                        }}
                    >
                        Join Discord
                    </Button>
                </Box>

                {/* Interactive Features Carousel */}
                <Box sx={{
                    mx: 'auto',
                    maxWidth: 1200,
                    borderRadius: 3, 
                    background: `
                        linear-gradient(90deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px),
                        linear-gradient(0deg, ${alpha(theme.palette.text.secondary, 0.02)} 1px, transparent 1px)
                    `,
                    backgroundSize: '16px 16px',
                    position: 'relative',
                }}>
                    <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 3,
                        height: '40vh',
                        minHeight: 320,
                    }}>
                        {/* Left Arrow */}
                        <IconButton 
                            onClick={handlePrevious}
                            sx={{ 
                                flexShrink: 0,
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                '&:hover': {
                                    bgcolor: alpha(theme.palette.primary.main, 0.2),
                                }
                            }}
                        >
                            <ArrowBackIosNewIcon />
                        </IconButton>

                        {/* Feature Content */}
                        <Box sx={{ 
                            flex: 1, 
                            display: 'flex', 
                            flexDirection: 'row',
                            gap: 4,
                            alignItems: 'center',
                        }}>
                            {/* Text Content */}
                            <Box sx={{ 
                                flex: 1,
                                textAlign: 'left',
                                minWidth: 300,
                            }}>
                                <Typography 
                                    variant="h4" 
                                    sx={{ 
                                        mb: 2, 
                                        fontWeight: 300,
                                        color: 'text.primary',
                                        letterSpacing: '0.02em'
                                    }}
                                >
                                    {features[currentFeature].title}
                                </Typography>
                                <Typography 
                                    variant="body1" 
                                    sx={{ 
                                        color: 'text.secondary',
                                        lineHeight: 1.8,
                                        fontSize: '1.1rem'
                                    }}
                                >
                                    {features[currentFeature].description}
                                </Typography>
                                
                                {/* Feature Indicators */}
                                <Box sx={{ display: 'flex', gap: 1, mt: 3 }}>
                                    {features.map((_, index) => (
                                        <Box
                                            key={index}
                                            onClick={() => setCurrentFeature(index)}
                                            sx={{
                                                width: 32,
                                                height: 4,
                                                borderRadius: 2,
                                                bgcolor: index === currentFeature 
                                                    ? theme.palette.primary.main 
                                                    : alpha(theme.palette.text.secondary, 0.2),
                                                cursor: 'pointer',
                                                transition: 'all 0.3s ease',
                                                '&:hover': {
                                                    bgcolor: index === currentFeature 
                                                        ? theme.palette.primary.main 
                                                        : alpha(theme.palette.text.secondary, 0.4),
                                                }
                                            }}
                                        />
                                    ))}
                                </Box>
                            </Box>

                            {/* Media Content */}
                            <Box sx={{ 
                                flex: 1,
                                borderRadius: 2,
                                overflow: 'hidden',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                minWidth: 300,
                                maxWidth: 500,
                            }}>
                                {features[currentFeature].mediaType === 'video' ? (
                                    <Box
                                        component="video"
                                        src={features[currentFeature].media}
                                        autoPlay
                                        loop
                                        muted
                                        playsInline
                                        sx={{
                                            width: '100%',
                                            height: 'auto',
                                            display: 'block',
                                        }}
                                    />
                                ) : (
                                    <Box
                                        component="img"
                                        src={features[currentFeature].media}
                                        alt={features[currentFeature].title}
                                        sx={{
                                            width: '100%',
                                            height: 'auto',
                                            display: 'block',
                                        }}
                                    />
                                )}
                            </Box>
                        </Box>

                        {/* Right Arrow */}
                        <IconButton 
                            onClick={handleNext}
                            sx={{ 
                                flexShrink: 0,
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                '&:hover': {
                                    bgcolor: alpha(theme.palette.primary.main, 0.2),
                                }
                            }}
                        >
                            <ArrowForwardIosIcon />
                        </IconButton>
                    </Box>
                </Box>
                
                {/* Screenshot Section */}
                <Box 
                    component="a"
                    href="/app"
                    sx={{
                        mt: 4,
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid rgba(0,0,0,0.1)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        mx: 2,
                        position: 'relative',
                        display: 'block',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        '&:hover': {
                            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                            transform: 'translateY(-2px)',
                            '& .hover-overlay': {
                                opacity: 1,
                            }
                        }
                    }}
                >
                    <Box 
                        component="img" 
                        sx={{
                            width: '100%',
                            height: 'auto',
                            display: 'block'
                        }} 
                        alt="Data Formulator screenshot" 
                        src={"/data-formulator-screenshot.png"} 
                    />
                    <Box
                        className="hover-overlay"
                        sx={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0,
                            transition: 'opacity 0.3s ease',
                            flexDirection: 'column',
                            gap: 2
                        }}
                    >
                        <Typography 
                            variant="h4" 
                            sx={{ 
                                color: 'text.primary', 
                                fontWeight: 300,
                                letterSpacing: '0.05em',
                                mb: 1
                            }}
                        >
                            Click to Get Started
                        </Typography>
                        <Typography 
                            variant="h6" 
                            sx={{ 
                                color: 'text.secondary',
                                fontWeight: 300
                            }}
                        >
                            Start exploring your data now →
                        </Typography>
                    </Box>
                </Box>
            </Box>

            {/* Footer */}
            <Button 
                size="small" 
                color="inherit" 
                sx={{
                    position: "absolute", 
                    color:'darkgray', 
                    bottom: 8, 
                    left: 16, 
                    textTransform: 'none'
                }} 
                target="_blank" 
                rel="noopener noreferrer" 
                href="https://privacy.microsoft.com/en-US/data-privacy-notice"
            >
                view data privacy notice
            </Button>
        </Box>)
}