import React, { FC, useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { ChartSuggestion } from "./ChartThumbnail";
import { SuggestionGrid } from "./SuggestionGrid";

export type ChartAssistantMode =
  | "REJECT"
  | "SUGGESTION"
  | "QC_SUGGEST"
  | "CONFIRM"
  | "INFO";

interface ChartAssistantModalProps {
  open: boolean;
  mode: ChartAssistantMode;
  title: string;
  message: string;
  suggestions: ChartSuggestion[];
  samplePrompts?: string[];
  initialCustomPrompt?: string;
  onClose: () => void;
  onDrawNow: (suggestion: ChartSuggestion) => void;
  onUsePrompt: (suggestion: ChartSuggestion) => void;
  onSubmitCustomPrompt?: (prompt: string) => void;
}

export const ChartAssistantModal: FC<ChartAssistantModalProps> = ({
  open,
  mode,
  title,
  message,
  suggestions,
  samplePrompts = [],
  initialCustomPrompt = "",
  onClose,
  onDrawNow,
  onUsePrompt,
  onSubmitCustomPrompt,
}) => {
  const [customPrompt, setCustomPrompt] = useState(initialCustomPrompt);
  const buildSuggestedPrompt = (suggestion: ChartSuggestion): string => {
    const suggestionText =
      suggestion.sample_prompt_vi || suggestion.rationale_vi || "";
    if (!suggestionText.trim()) {
      return `Draw ${suggestion.chart_type}`;
    }
    const hasChartTypeInText = suggestionText
      .toLowerCase()
      .includes((suggestion.chart_type || "").toLowerCase());
    if (hasChartTypeInText) {
      return suggestionText;
    }
    return `Draw ${suggestion.chart_type}: ${suggestionText}`;
  };

  useEffect(() => {
    if (open) {
      setCustomPrompt(initialCustomPrompt || "");
    }
  }, [open, initialCustomPrompt]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 14, mb: 1.5, whiteSpace: "pre-line" }}>
          {message}
        </Typography>
        {(mode === "SUGGESTION" ||
          mode === "QC_SUGGEST" ||
          mode === "CONFIRM" ||
          mode === "REJECT") &&
          suggestions.length > 0 && (
            <SuggestionGrid
              suggestions={
                mode === "QC_SUGGEST" ? suggestions.slice(0, 3) : suggestions
              }
              onDrawNow={onDrawNow}
              onUsePrompt={(suggestion) => {
                setCustomPrompt(buildSuggestedPrompt(suggestion));
                onUsePrompt(suggestion);
              }}
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
        {suggestions.length > 0 && (
          <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              Customize your prompt
            </Typography>
            <TextField
              fullWidth
              size="small"
              multiline
              minRows={2}
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Edit and submit your prompt..."
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="small"
                variant="contained"
                disabled={!customPrompt.trim()}
                onClick={() => onSubmitCustomPrompt?.(customPrompt.trim())}
              >
                Submit Prompt
              </Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

