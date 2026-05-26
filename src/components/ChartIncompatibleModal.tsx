import React, { FC } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  Typography,
} from "@mui/material";
import { ChartRejectInfo } from "../app/dfSlice";

interface ChartIncompatibleModalProps {
  open: boolean;
  reject: ChartRejectInfo | null;
  onClose: () => void;
  onApplySuggestion: (chartType: string) => void;
}

export const ChartIncompatibleModal: FC<ChartIncompatibleModalProps> = ({
  open,
  reject,
  onClose,
  onApplySuggestion,
}) => {
  const suggestedChartTypes = reject?.suggested_chart_types || [];
  const suggestedActions = reject?.suggested_actions || [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Biểu đồ không tương thích</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 14 }}>
          {reject?.message_vi || "Không thể tạo biểu đồ với dữ liệu hiện tại."}
        </Typography>

        {suggestedActions.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              Gợi ý thao tác
            </Typography>
            <List dense sx={{ py: 0 }}>
              {suggestedActions.map((action, idx) => (
                <ListItem key={`${action}-${idx}`} sx={{ px: 0, py: 0.25 }}>
                  <Typography sx={{ fontSize: 13 }}>- {action}</Typography>
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {suggestedChartTypes.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              Gợi ý loại biểu đồ
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1 }}>
              {suggestedChartTypes.map((chartType) => (
                <Button
                  key={chartType}
                  size="small"
                  variant="outlined"
                  onClick={() => onApplySuggestion(chartType)}
                >
                  Apply suggestion: {chartType}
                </Button>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Đóng</Button>
      </DialogActions>
    </Dialog>
  );
};
