import React, { FC } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { ChartSuggestion } from "./ChartThumbnail";
import { SuggestionGrid } from "./SuggestionGrid";

export type ChartAssistantMode = "REJECT" | "SUGGESTION" | "CONFIRM" | "INFO";

interface ChartAssistantModalProps {
  open: boolean;
  mode: ChartAssistantMode;
  title: string;
  message: string;
  suggestions: ChartSuggestion[];
  samplePrompts?: string[];
  onClose: () => void;
  onDrawNow: (suggestion: ChartSuggestion) => void;
  onUsePrompt: (suggestion: ChartSuggestion) => void;
}

export const ChartAssistantModal: FC<ChartAssistantModalProps> = ({
  open,
  mode,
  title,
  message,
  suggestions,
  samplePrompts = [],
  onClose,
  onDrawNow,
  onUsePrompt,
}) => {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 14, mb: 1.5 }}>{message}</Typography>
        {(mode === "SUGGESTION" || mode === "CONFIRM" || mode === "REJECT") &&
          suggestions.length > 0 && (
            <SuggestionGrid
              suggestions={suggestions}
              onDrawNow={onDrawNow}
              onUsePrompt={onUsePrompt}
            />
          )}
        {mode === "INFO" && samplePrompts.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {samplePrompts.map((p, i) => (
              <Typography key={`${p}-${i}`} sx={{ fontSize: 13, mb: 0.5 }}>
                - {p}
              </Typography>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
};

