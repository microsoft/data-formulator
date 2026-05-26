import React, { FC } from "react";
import { Box } from "@mui/material";
import { ChartSuggestion, ChartThumbnail } from "./ChartThumbnail";

interface SuggestionGridProps {
  suggestions: ChartSuggestion[];
  onDrawNow: (suggestion: ChartSuggestion) => void;
  onUsePrompt: (suggestion: ChartSuggestion) => void;
}

export const SuggestionGrid: FC<SuggestionGridProps> = ({
  suggestions,
  onDrawNow,
  onUsePrompt,
}) => {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
        gap: 1,
      }}
    >
      {suggestions.map((s, idx) => (
        <ChartThumbnail
          key={`${s.chart_type}-${idx}`}
          suggestion={s}
          onDrawNow={onDrawNow}
          onUsePrompt={onUsePrompt}
        />
      ))}
    </Box>
  );
};

