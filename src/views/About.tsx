// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Box, Typography, Button, useTheme, alpha, IconButton } from "@mui/material";
import React, { FC, useState } from "react";
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import GridViewIcon from '@mui/icons-material/GridView';

import dfLogo from '../assets/df-logo.png';
import { toolName } from "../app/App";

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
        }}>
            <Box sx={{margin:'auto', pb: '5%', display: "flex", flexDirection: "column", textAlign: "center", maxWidth: 1200}}>
                {/* Header with logo and title */}
                <Box sx={{
                    display: 'flex', 
                    mx: 'auto', 
                    mt: 6,
                    mb: 2,
                    width: 'fit-content', 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    justifyContent: 'center',
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
                <Typography fontSize={18} sx={{mb: 4, color: 'text.secondary', lineHeight: 1.8}}>
                    Turn (almost) any data into insights with AI agents, with the exploration paths you choose. 
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 6, flexWrap: 'wrap' }}>
                    <Button size="large" variant="contained" color="primary" 
                        startIcon={<GridViewIcon sx={{ fontSize: '1rem' }} />}
                        href="/app"
                    >Start Exploration</Button>
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
                        mt: 6,
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