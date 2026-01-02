// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { useState, useEffect, useRef } from "react";
import ChatbotPanel from "./ChatbotPanel";
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Alert,
  Typography,
  Paper,
  Container,
  useTheme,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DataUsageIcon from "@mui/icons-material/DataUsage";
import InventoryIcon from "@mui/icons-material/Inventory";
import BarChartIcon from "@mui/icons-material/BarChart";
import AssessmentIcon from "@mui/icons-material/Assessment";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import StorageIcon from "@mui/icons-material/Storage";

interface Dashboard {
  oid: string;
  name: string;
  url: string;
  lastupdate: string;
}

interface DashboardsByDept {
  [department: string]: Dashboard[];
}

// Function to get icon based on dashboard name
const getDashboardIcon = (dashboardName: string) => {
  const name = dashboardName.toLowerCase();

  if (name.includes("sales") || name.includes("revenue")) {
    return <TrendingUpIcon sx={{ fontSize: 20, color: "primary.main" }} />;
  } else if (name.includes("inventory") || name.includes("stock")) {
    return <InventoryIcon sx={{ fontSize: 20, color: "success.main" }} />;
  } else if (name.includes("analytics") || name.includes("analysis")) {
    return <AnalyticsIcon sx={{ fontSize: 20, color: "info.main" }} />;
  } else if (name.includes("data")) {
    return <DataUsageIcon sx={{ fontSize: 20, color: "warning.main" }} />;
  } else if (name.includes("performance") || name.includes("metric")) {
    return <AssessmentIcon sx={{ fontSize: 20, color: "error.main" }} />;
  } else if (name.includes("chart") || name.includes("report")) {
    return <BarChartIcon sx={{ fontSize: 20, color: "secondary.main" }} />;
  } else if (name.includes("database") || name.includes("storage")) {
    return <StorageIcon sx={{ fontSize: 20, color: "info.main" }} />;
  } else {
    return <DashboardIcon sx={{ fontSize: 20, color: "primary.main" }} />;
  }
};

export const DashboardView: React.FC = () => {
  // All hooks MUST be declared before any conditional returns
  const [dashboards, setDashboards] = useState<DashboardsByDept>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [chatbotOpen, setChatbotOpen] = useState<boolean>(false);

  const theme = useTheme();

  useEffect(() => {
    const fetchDashboards = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/dashboard/list", {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.status === "success") {
          setDashboards(result.data || {});
        } else {
          setError(result.message || "Failed to fetch dashboards");
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "An unknown error occurred";
        setError(errorMessage);
        console.error("Error fetching dashboards:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboards();
  }, []);

  const handleDashboardClick = (url: string) => {
    // Open dashboard in new tab
    window.open(url, "_blank");
  };

  // Now safe to have early returns after all hooks are declared
  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error">Error loading dashboards: {error}</Alert>
      </Container>
    );
  }

  const departments = Object.keys(dashboards).sort();

  if (departments.length === 0) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="info">No dashboards available</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth={false} sx={{ py: 4, width: "90%" }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ mb: 1, fontWeight: 600 }}>
          Dashboards
        </Typography>
      </Box>

      {/* Main Layout: 70% Carousel + Charts | 30% Chatbot */}
      <Box sx={{ display: "flex", gap: 3, minHeight: "auto" }}>
        {/* Left Section: 70% Carousel + Charts */}
        <Box
          sx={{
            flex: chatbotOpen ? "0 0 70%" : "1",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {/* Carousel Section */}
          <Paper
            sx={{
              p: 2,
              backgroundColor: "#fffdfdf1",
              borderRadius: "16px",
              boxShadow: "0 2px 12px rgba(0, 0, 0, 0.08)",
              position: "relative",
              display: "flex",
              flexDirection: "column",
              transition: "all 0.3s ease",
              "&:hover": {
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.12)",
              },
            }}
          >
            {/* Department Cards Grid - All departments displayed */}
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, 1fr)",
                  lg: "repeat(3, 1fr)",
                },
                gap: 2,
              }}
            >
              {departments.map((department) => {
                const deptDashboards = dashboards[department];

                return (
                  <Box key={department}>
                    <Card
                      sx={{
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        transition: "all 0.3s ease",
                        "&:hover": {
                          boxShadow: "0 8px 16px rgba(0, 0, 0, 0.15)",
                        },
                      }}
                    >
                      {/* Department Header */}
                      <CardContent
                        sx={{
                          pb: 1.5,
                          backgroundColor: "#091722ff",
                          borderRadius: "8px 8px 0 0",
                          mr: 0,
                          ml: 0,
                        }}
                      >
                        <Typography
                          variant="h6"
                          component="h3"
                          sx={{ fontWeight: 700, mb: 0, color: "white" }}
                        >
                          {department}
                        </Typography>
                      </CardContent>

                      {/* Dashboard Buttons List */}
                      <CardContent sx={{ pt: 2.5 }}>
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 1.5,
                          }}
                        >
                          {deptDashboards.map((dashboard) => (
                            <Box
                              key={dashboard.oid}
                              onClick={() =>
                                handleDashboardClick(dashboard.url)
                              }
                              sx={{
                                p: 1.5,
                                backgroundColor: "#f8f9fa",
                                border: "1.5px solid #1976d2",
                                borderRadius: 1.5,
                                cursor: "pointer",
                                transition: "all 0.3s ease",
                                display: "flex",
                                alignItems: "center",
                                gap: 1.2,
                                "&:hover": {
                                  backgroundColor: "#1976d2",
                                  borderColor: "#1565c0",
                                  boxShadow:
                                    "0 4px 12px rgba(25, 118, 210, 0.25)",
                                  transform: "translateY(-2px)",
                                  "& .MuiTypography-root": {
                                    color: "white",
                                  },
                                  "& .MuiSvgIcon-root": {
                                    color: "white",
                                  },
                                },
                              }}
                            >
                              {getDashboardIcon(dashboard.name)}
                              <Box
                                sx={{
                                  flex: 1,
                                }}
                              >
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 600,
                                    color: "#1976d2",
                                    transition: "color 0.3s ease",
                                  }}
                                >
                                  {dashboard.name}
                                </Typography>
                              </Box>
                              <OpenInNewIcon
                                sx={{
                                  fontSize: 18,
                                  color: "#1976d2",
                                  transition: "color 0.3s ease",
                                }}
                              />
                            </Box>
                          ))}
                        </Box>
                      </CardContent>
                    </Card>
                  </Box>
                );
              })}
            </Box>
          </Paper>
        </Box>

        {/* Chatbot Component */}
        <ChatbotPanel
          isOpen={chatbotOpen}
          onClose={() => setChatbotOpen(false)}
          onOpen={() => setChatbotOpen(true)}
        />
      </Box>
    </Container>
  );
};

export default DashboardView;
