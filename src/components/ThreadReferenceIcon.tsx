// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React from 'react';
import { Box, ButtonBase, SxProps } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import { useDispatch, useSelector } from 'react-redux';
import { dfActions, dfSelectors, DataFormulatorState } from '../app/dfSlice';
import { textVar } from '../app/layout';
import { ThreadReference } from './ComponentType';
import { chartFamilyIcon, FileTypeIcon, TableIcon } from '../icons';

/** The icon of an item a request refers to: its chart family, a table, a report, or the file's type. */
export const ThreadReferenceIcon: React.FC<{ reference: ThreadReference; size?: number; sx?: SxProps }> = ({ reference, size = 12, sx }) => {
    const chartType = useSelector((state: DataFormulatorState) => reference.kind === 'chart'
        ? dfSelectors.getAllCharts(state).find(chart => chart.id === reference.id)?.chartType : undefined);
    const path = useSelector((state: DataFormulatorState) => reference.kind === 'file'
        ? state.fileNodes.find(node => node.id === reference.id)?.path : undefined);
    const iconSx = { width: size, height: size, fontSize: size, flexShrink: 0, ...sx } as SxProps;
    if (reference.kind === 'chart' && chartType) {
        const Icon = chartFamilyIcon(chartType);
        return <Icon sx={iconSx} />;
    }
    if (reference.kind === 'report') return <ArticleOutlinedIcon sx={iconSx} />;
    if (reference.kind === 'file' && path) return <FileTypeIcon path={path} size={size} sx={sx} />;
    return <TableIcon sx={iconSx} />;
};

/** The earlier results a message is about, as small chips (like its attachments); clicking one focuses it. */
export const ThreadReferenceChips: React.FC<{ references: ThreadReference[]; sx?: SxProps }> = ({ references, sx }) => {
    const dispatch = useDispatch();
    const fileNodes = useSelector((state: DataFormulatorState) => state.fileNodes);
    const focus = (reference: ThreadReference) => {
        if (reference.kind === 'chart') dispatch(dfActions.setFocused({ type: 'chart', chartId: reference.id }));
        else if (reference.kind === 'table') dispatch(dfActions.setFocused({ type: 'table', tableId: reference.id }));
        else if (reference.kind === 'report') dispatch(dfActions.setFocused({ type: 'report', reportId: reference.id }));
        else {
            const file = fileNodes.find(node => node.id === reference.id);
            if (file) dispatch(dfActions.setFocused({ type: 'file', fileName: file.path }));
        }
    };
    return <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px', ...sx } as SxProps}>
        {references.map(reference => <ButtonBase key={`${reference.kind}:${reference.id}`} data-thread-reference
            onClick={event => { event.stopPropagation(); focus(reference); }}
            sx={theme => ({
                display: 'inline-flex', alignItems: 'center', gap: '3px', maxWidth: '100%', fontSize: textVar.xxs,
                fontFamily: theme.typography.fontFamily, color: 'text.secondary', bgcolor: alpha(theme.palette.text.primary, 0.05),
                border: `1px solid ${theme.palette.divider}`, borderRadius: '4px', px: '5px', py: '1px',
                '&:hover': { color: 'text.primary', bgcolor: alpha(theme.palette.text.primary, 0.08) },
                '&.Mui-focusVisible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
            })}>
            <ThreadReferenceIcon reference={reference} />
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reference.label}</Box>
        </ButtonBase>)}
    </Box>;
};
