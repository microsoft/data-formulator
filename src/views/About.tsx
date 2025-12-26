// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  Box,
  Typography,
  Button,
  useTheme,
  alpha,
  IconButton,
  Divider,
} from "@mui/material";
import React, { FC, useState, useEffect, useRef } from "react";
import ArrowBackIosNewIcon from "@mui/icons-material/ArrowBackIosNew";
import ArrowForwardIosIcon from "@mui/icons-material/ArrowForwardIos";
import GridViewIcon from "@mui/icons-material/GridView";
import GitHubIcon from "@mui/icons-material/GitHub";
import YouTubeIcon from "@mui/icons-material/YouTube";
import PrecisionManufacturingIcon from "@mui/icons-material/PrecisionManufacturing";

// import dfLogo from "../assets/df-logo.png";
import dfLogo from "../assets/logo_HOGV DataViz Assistant.png";
import { toolName } from "../app/App";
import { useSelector } from "react-redux";
import { DataFormulatorState } from "../app/dfSlice";

interface Feature {
  title: string;
  description: string;
  media: string;
  mediaType: "image" | "video";
}

const features: Feature[] = [
  {
    title: "Load (Almost) Any Data",
    description:
      "Load structured data, connect to databases. Ask AI agents to extract and clean (small) ad-hoc data from screenshots, text blocks.",
    media: "/feature-extract-data.mp4",
    mediaType: "video",
  },
  {
    title: "Agent Mode",
    description:
      "Vibe with your data. Hands-off and let agents automatically explore and visualize data from high-level goals.",
    media: "/feature-agent-mode.mp4",
    mediaType: "video",
  },
  {
    title: "Interactive Control",
    description:
      "Use UI interactions and natural language to precisely describe chart designs. Ask AI agents for recommendations. Use Data Threads to backtrack, explore new branches, or follow up.",
    media: "/feature-interactive-control.mp4",
    mediaType: "video",
  },
  {
    title: "Verify & Share Insights",
    description:
      "Interact with charts, inspect data, formulas, and code. Create reports to share insights grounded in your exploration.",
    media: "/feature-generate-report.mp4",
    mediaType: "video",
  },
];

export const About: FC<{}> = function About({}) {
  const theme = useTheme();
  const [currentFeature, setCurrentFeature] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoDurationsRef = useRef<Map<string, number>>(new Map());

  const handlePrevious = () => {
    setCurrentFeature((prev) => (prev === 0 ? features.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentFeature((prev) => (prev === features.length - 1 ? 0 : prev + 1));
  };

  // Auto-advance features based on video duration
  useEffect(() => {
    const currentMedia = features[currentFeature].media;
    const isVideo = features[currentFeature].mediaType === "video";

    // Default duration for images or if video duration is not yet loaded
    let duration = 10000; // 10 seconds for images

    if (isVideo && videoDurationsRef.current.has(currentMedia)) {
      // Use the stored video duration (in milliseconds)
      duration = videoDurationsRef.current.get(currentMedia)! * 1000;
      duration = duration + 3000; // add 3 seconds to the video duration
    }

    const timeoutId = setTimeout(() => {
      setCurrentFeature((prev) => (prev + 1) % features.length);
    }, duration);

    return () => clearTimeout(timeoutId);
  }, [currentFeature]);

  // Preload adjacent carousel items for smoother transitions
  useEffect(() => {
    const preloadMedia = (index: number) => {
      const feature = features[index];
      if (feature.mediaType === "video") {
        const video = document.createElement("video");
        video.src = feature.media;
        video.preload = "metadata";
      } else {
        const img = new Image();
        img.src = feature.media;
      }
    };

    // Preload next and previous features
    const nextIndex = (currentFeature + 1) % features.length;
    const prevIndex =
      currentFeature === 0 ? features.length - 1 : currentFeature - 1;

    preloadMedia(nextIndex);
    preloadMedia(prevIndex);
  }, [currentFeature]);

  const serverConfig = useSelector(
    (state: DataFormulatorState) => state.serverConfig
  );

  let actionButtons = !serverConfig.PROJECT_FRONT_PAGE ? (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        gap: 1,
        mb: 4,
        flexWrap: "wrap",
      }}
    >
      <Button
        size="large"
        variant="contained"
        color="primary"
        startIcon={<PrecisionManufacturingIcon sx={{ fontSize: "1rem" }} />}
        href="/app"
      >
        Start Exploration
      </Button>
    </Box>
  ) : (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        gap: 2,
        mb: 4,
        flexWrap: "wrap",
        ".MuiButton-root": { textTransform: "none" },
      }}
    >
      <Button
        size="large"
        variant="outlined"
        color="primary"
        startIcon={<YouTubeIcon sx={{ fontSize: "1rem", color: "#FF0000" }} />}
        target="_blank"
        rel="noopener noreferrer"
        href="https://www.youtube.com/watch?v=GfTE2FLyMrs"
      >
        What's New in v0.5?
      </Button>
      <Button
        size="large"
        variant="outlined"
        color="primary"
        startIcon={<GitHubIcon sx={{ fontSize: "1rem", color: "#000000" }} />}
        target="_blank"
        rel="noopener noreferrer"
        href="https://github.com/microsoft/data-formulator"
      >
        GitHub
      </Button>
      <Divider orientation="vertical" sx={{ mx: 1 }} flexItem />
      <Button
        size="large"
        variant="outlined"
        color="primary"
        startIcon={
          <Box
            component="img"
            sx={{ width: 24, height: 24 }}
            alt=""
            src="/pip-logo.svg"
          />
        }
        target="_blank"
        rel="noopener noreferrer"
        href="https://pypi.org/project/data-formulator/"
      >
        Install Locally
      </Button>
      <Button
        size="large"
        variant="outlined"
        color="primary"
        sx={{
          animation: "subtleGlow 2s ease-in-out infinite",
          "@keyframes subtleGlow": {
            "0%, 100%": {
              boxShadow: `0 0 8px ${alpha(
                theme.palette.primary.main,
                0.4
              )}, 0 0 16px ${alpha(theme.palette.primary.main, 0.2)}`,
            },
            "50%": {
              boxShadow: `0 0 12px ${alpha(
                theme.palette.primary.main,
                0.6
              )}, 0 0 24px ${alpha(
                theme.palette.primary.main,
                0.3
              )}, 0 0 32px ${alpha(theme.palette.primary.main, 0.1)}`,
            },
          },
          "&:hover": {
            animation: "subtleGlow 1.5s ease-in-out infinite",
            boxShadow: `0 0 16px ${alpha(
              theme.palette.primary.main,
              0.7
            )}, 0 0 32px ${alpha(theme.palette.primary.main, 0.4)} !important`,
          },
        }}
        startIcon={<GridViewIcon sx={{ fontSize: "1rem" }} />}
        href="/app"
      >
        Try Online Demo
      </Button>
      <Typography
        variant="caption"
        sx={{ mt: 1.5, color: "text.secondary", fontStyle: "italic" }}
      >
        Psst — install locally for the full experience ✨. The online demo has
        limited features (at the moment).
      </Typography>
    </Box>
  );

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        textAlign: "center",
        overflowY: "auto",
        width: "100%",
        height: "100%",
      }}
    >
      <Box
        sx={{
          margin: "auto",
          pb: "5%",
          display: "flex",
          flexDirection: "column",
          textAlign: "center",
          maxWidth: 1200,
        }}
      >
        {/* Header with logo and title */}
        <Box
          sx={{
            display: "flex",
            mx: "auto",
            mt: 6,
            mb: 2,
            width: "fit-content",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Box component="img" sx={{ width: 96 }} alt="" src={dfLogo} />
          <Typography
            fontSize={72}
            sx={{
              ml: 2,
              letterSpacing: "0.05em",
              fontWeight: 200,
              color: "text.primary",
              display: "flex",
              flexDirection: "row",
              alignItems: "baseline",
            }}
          >
            {toolName}{" "}
          </Typography>
        </Box>
        <Typography
          fontSize={18}
          sx={{ mb: 4, color: "text.secondary", lineHeight: 1.8 }}
        >
          Turn (almost) any data into insights with AI agents, with the
          exploration paths you choose.
        </Typography>
        {actionButtons}

        {/* Interactive Features Carousel */}
        <Box
          sx={{
            mx: "auto",
            maxWidth: 1200,
            borderRadius: 3,
            background: `
                        linear-gradient(90deg, ${alpha(
                          theme.palette.text.secondary,
                          0.02
                        )} 1px, transparent 1px),
                        linear-gradient(0deg, ${alpha(
                          theme.palette.text.secondary,
                          0.02
                        )} 1px, transparent 1px)
                    `,
            backgroundSize: "16px 16px",
            position: "relative",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              height: "40vh",
              minHeight: 320,
            }}
          >
            {/* Left Arrow */}
            <IconButton
              onClick={handlePrevious}
              sx={{
                flexShrink: 0,
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                "&:hover": {
                  bgcolor: alpha(theme.palette.primary.main, 0.2),
                },
              }}
            >
              <ArrowBackIosNewIcon />
            </IconButton>

            {/* Feature Content */}
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "row",
                gap: 4,
                alignItems: "center",
              }}
            >
              {/* Text Content */}
              <Box
                sx={{
                  flex: 1,
                  textAlign: "left",
                  minWidth: 300,
                }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    mb: 2,
                    fontWeight: 300,
                    color: "text.primary",
                    letterSpacing: "0.02em",
                  }}
                >
                  {features[currentFeature].title}
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    color: "text.secondary",
                    lineHeight: 1.8,
                    fontSize: "1.1rem",
                  }}
                >
                  {features[currentFeature].description}
                </Typography>

                {/* Feature Indicators */}
                <Box sx={{ display: "flex", gap: 1, mt: 3 }}>
                  {features.map((_, index) => (
                    <Box
                      key={index}
                      onClick={() => setCurrentFeature(index)}
                      sx={{
                        width: 32,
                        height: 4,
                        borderRadius: 2,
                        bgcolor:
                          index === currentFeature
                            ? theme.palette.primary.main
                            : alpha(theme.palette.text.secondary, 0.2),
                        cursor: "pointer",
                        transition: "all 0.3s ease",
                        "&:hover": {
                          bgcolor:
                            index === currentFeature
                              ? theme.palette.primary.main
                              : alpha(theme.palette.text.secondary, 0.4),
                        },
                      }}
                    />
                  ))}
                </Box>
              </Box>

              {/* Media Content */}
              <Box
                sx={{
                  flex: 1,
                  borderRadius: 2,
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  minWidth: 300,
                  maxWidth: 500,
                }}
              >
                {features[currentFeature].mediaType === "video" ? (
                  <Box
                    component="video"
                    key={features[currentFeature].media}
                    src={features[currentFeature].media}
                    ref={videoRef}
                    autoPlay
                    loop
                    muted
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      const video = e.currentTarget as HTMLVideoElement;
                      if (video.duration && !isNaN(video.duration)) {
                        videoDurationsRef.current.set(
                          features[currentFeature].media,
                          video.duration
                        );
                      }
                    }}
                    sx={{
                      width: "100%",
                      height: "auto",
                      display: "block",
                    }}
                  />
                ) : (
                  <Box
                    component="img"
                    src={features[currentFeature].media}
                    alt={features[currentFeature].title}
                    loading="lazy"
                    sx={{
                      width: "100%",
                      height: "auto",
                      display: "block",
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
                "&:hover": {
                  bgcolor: alpha(theme.palette.primary.main, 0.2),
                },
              }}
            >
              <ArrowForwardIosIcon />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ mt: 6, mx: 2 }}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              How does HOGV DataViz Assistant handle your data?
            </Typography>
            <Typography
              component="ul"
              variant="caption"
              sx={{
                fontWeight: 300,
                mt: 1,
                color: "text.primary",
                letterSpacing: "0.02em",
                textAlign: "left",
                maxWidth: 1000,
              }}
            >
              <ul>
                <li>
                  📦 <strong>Data Storage:</strong> Uploaded data (csv, xlsx,
                  json, clipboard, messy data etc.) is stored in browser's local
                  storage only
                </li>
                <li>
                  ⚙️ <strong>Data Processing:</strong> Local installation runs
                  Python on your machine; online demo sends the data to server
                  for data transformations (but not stored)
                </li>
                <li>
                  🗄️ <strong>Database:</strong> Only available for locally
                  installed Data Formulator (a DuckDB database file is created
                  in temp directory to store data); not available in online demo
                </li>
                <li>
                  🤖 <strong>LLM Endpoints:</strong> Small data samples are sent
                  to LLM endpoints along with the prompt. Use your trusted model
                  provider if working with private data.
                </li>
              </ul>
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
