import React, { FC } from "react";
import { Box, Button, Chip, Typography } from "@mui/material";

export interface ChartSuggestion {
  chart_type: string;
  encoding: Record<string, string>;
  confidence?: number;
  rationale_vi?: string;
  sample_prompt_vi?: string;
}

interface ChartThumbnailProps {
  suggestion: ChartSuggestion;
  onDrawNow: (suggestion: ChartSuggestion) => void;
  onUsePrompt: (suggestion: ChartSuggestion) => void;
}

export const ChartThumbnail: FC<ChartThumbnailProps> = ({
  suggestion,
  onDrawNow,
  onUsePrompt,
}) => {
  return (
    <Box
      sx={{
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 1,
        p: 1,
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
        {suggestion.chart_type}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
        {Object.entries(suggestion.encoding || {}).map(([k, v]) => (
          <Chip
            key={`${suggestion.chart_type}-${k}-${v}`}
            size="small"
            label={`${k}: ${v}`}
            sx={{ fontSize: 10, height: 20 }}
          />
        ))}
      </Box>
      {suggestion.rationale_vi && (
        <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
          {suggestion.rationale_vi}
        </Typography>
      )}
      <Box sx={{ display: "flex", gap: 0.75 }}>
        <Button size="small" variant="contained" onClick={() => onDrawNow(suggestion)}>
          Vẽ ngay
        </Button>
        <Button size="small" variant="outlined" onClick={() => onUsePrompt(suggestion)}>
          💬 Dùng
        </Button>
      </Box>
    </Box>
  );
};

