// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import React, { FC } from 'react';
import {
    Box,
    Button,
    Typography,
    alpha,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import {
    Chart,
    Insight,
    InsightKind,
    computeInsightKey,
} from '../components/ComponentType';
import {
    DataFormulatorState,
    fetchChartInsight,
} from '../app/dfSlice';
import { AppDispatch } from '../app/store';
import { transition } from '../app/tokens';
import { WritingIndicator } from '../components/FunComponents';

import { KIND_CONFIG, deriveInsightTitle } from './insightConfig';

interface InsightSidebarProps {
    chart: Chart;
    tableId: string;
    activeInsightIdx: number | null;
    setActiveInsightIdx: React.Dispatch<React.SetStateAction<number | null>>;
}

export const InsightSidebarFC: FC<InsightSidebarProps> = ({
    chart,
    tableId,
    activeInsightIdx,
    setActiveInsightIdx,
}) => {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const chartInsightInProgress = useSelector((state: DataFormulatorState) => state.chartInsightInProgress) || [];
    const insightLoading = chartInsightInProgress.includes(chart.id);

    const currentInsightKey = computeInsightKey(chart);
    const insightFresh = chart.insight?.key === currentInsightKey;

    const triggerInsightFetch = () => {
        dispatch(fetchChartInsight({ chartId: chart.id, tableId }) as any);
    };

    // Loading state
    if (insightLoading) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', p: 1 }}>
                <WritingIndicator label={t('chart.analyzingChart')} />
            </Box>
        );
    }

    // No insight yet — show generate button
    if (!insightFresh || !chart.insight) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', p: 1 }}>
                <Typography fontSize="11px" color="text.secondary" sx={{ mb: 0.5 }}>
                    {t('chart.noInsightAvailable')}
                </Typography>
                <Button
                    size="small"
                    sx={{ textTransform: 'none', fontSize: '0.7rem' }}
                    onClick={triggerInsightFetch}
                >
                    {t('chart.generateInsight')}
                </Button>
            </Box>
        );
    }

    const insights: Insight[] = chart.insight.insights
        || chart.insight.takeaways?.map(tw => ({ text: tw }))
        || [];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5, ml: 0.5 }}>
                {t('chart.insight')}
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {insights.map((insight, i) => {
                    const isActive = activeInsightIdx === i;
                    const kind: InsightKind = (insight.kind && KIND_CONFIG[insight.kind])
                        ? insight.kind
                        : 'observation';
                    const cfg = KIND_CONFIG[kind];
                    const displayTitle = deriveInsightTitle(insight);

                    return (
                        <Box
                            key={i}
                            onClick={() => {
                                setActiveInsightIdx(prev => prev === i ? null : i);
                            }}
                            sx={{
                                position: 'relative',
                                cursor: 'pointer',
                                borderLeft: '3px solid',
                                borderLeftColor: (theme) => isActive
                                    ? theme.palette.primary.main
                                    : theme.palette.divider,
                                borderRadius: '2px',
                                backgroundColor: (theme) => isActive
                                    ? theme.palette.action.selected
                                    : alpha(theme.palette.background.paper, 0.5),
                                padding: '6px 10px 8px 10px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                transition: transition.normal,
                                '&:hover': {
                                    backgroundColor: (theme) => theme.palette.action.hover,
                                },
                            }}
                        >
                            {/* Row 1 — eyebrow: UPPERCASE type label */}
                            <Typography sx={{
                                fontSize: '10px',
                                fontWeight: 600,
                                letterSpacing: 0.6,
                                textTransform: 'uppercase',
                                color: 'text.secondary',
                                lineHeight: 1,
                            }}>
                                {cfg.label}
                            </Typography>

                            {/* Row 2 — title (wraps) */}
                            <Typography sx={{
                                fontSize: '13px',
                                fontWeight: isActive ? 700 : 600,
                                lineHeight: 1.35,
                                color: 'text.primary',
                                wordBreak: 'break-word',
                            }}>
                                {displayTitle}
                            </Typography>

                            {/* Row 3 — full description, only when this insight is selected */}
                            {isActive && insight.text && insight.text !== displayTitle && (
                                <Typography sx={{
                                    fontSize: '12px',
                                    lineHeight: 1.5,
                                    color: 'text.secondary',
                                    mt: '4px',
                                    wordBreak: 'break-word',
                                }}>
                                    {insight.text}
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </Box>

            <Button
                size="small"
                sx={{ alignSelf: 'flex-start', mt: 0.5, textTransform: 'none', fontSize: '0.7rem' }}
                onClick={() => {
                    setActiveInsightIdx(null);
                    triggerInsightFetch();
                }}
            >
                {t('chart.regenerate')}
            </Button>
        </Box>
    );
};
