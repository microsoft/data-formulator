import React, { FC } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

import { dfActions } from '../app/dfSlice';
import { iconVar, textVar } from '../app/layout';
import { agentResponseFill, borderColor } from '../app/tokens';
import { AgentToyIcon } from './AgentToyIcon';
import { CompactMarkdown } from './InteractionEntryCard';

interface ExplanationCanvasProps {
    content: string;
    sourceTableId?: string;
    timestamps?: number[];
    textTurnId?: string;
}

export const ExplanationCanvas: FC<ExplanationCanvasProps> = ({ content, sourceTableId, timestamps, textTurnId }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation();
    const theme = useTheme();
    const canDelete = !!textTurnId || (!!sourceTableId && !!timestamps?.length);

    const handleDelete = () => {
        if (textTurnId) {
            dispatch(dfActions.removeTextTurn(textTurnId));
            return;
        }
        if (sourceTableId && timestamps?.length) {
            dispatch(dfActions.removeInteractionEntries({ tableId: sourceTableId, timestamps }));
        }
        dispatch(dfActions.setFocused(undefined));
    };

    return (
        <Box id="vis-view-canvas" sx={{
            width: '100%', height: '100%', overflow: 'hidden', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column',
            backgroundColor: agentResponseFill(theme.palette.primary.main),
            borderRadius: '6px',
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', px: 2, py: 1.25, borderBottom: `1px solid ${borderColor.component}` }}>
                <AgentToyIcon variant="explain" sx={{ fontSize: iconVar.md, color: 'primary.main' }} />
                <Typography component="h2" sx={{
                    fontSize: textVar.xs, fontWeight: 600, color: 'text.primary',
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                    {t('chartRec.explanationTitle')}
                </Typography>
                {canDelete && (
                    <Tooltip title={t('chartRec.pauseDelete')}>
                        <IconButton size="small" color="error" onClick={handleDelete} aria-label={t('chartRec.pauseDelete')}>
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                )}
                <Box sx={{ flex: 1 }} />
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 3, py: 2.5, fontSize: textVar.sm, userSelect: 'text' }}>
                <CompactMarkdown content={content} color="text.primary" />
            </Box>
        </Box>
    );
};