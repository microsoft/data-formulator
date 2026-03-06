// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC } from "react";
import { Box, Typography } from "@mui/material";

export const LiveView: FC = () => {
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255, 255, 255, 0.5)",
      }}
    >
      <Typography variant="h6" color="text.secondary">
        QC Live View
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Coming soon...
      </Typography>
    </Box>
  );
};
