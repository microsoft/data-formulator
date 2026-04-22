// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useEffect, useState, useMemo } from 'react';

import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { Button, Chip } from '@mui/material';
import { borderColor } from '../app/tokens';
import { StreamIcon } from '../icons';
import { createTableFromFromObjectArray } from '../data/utils';
import { MultiTablePreview } from './MultiTablePreview';
import { DictTable } from '../components/ComponentType';

// Update the interface to support multiple tables per dataset
export interface DatasetMetadata {
    name: string;
    description: string;
    source: string;
    tables: {
        table_name: string;
        url: string;
        format: string;
        sample: any[];
    }[];
    // Live/streaming dataset properties
    live?: boolean;
    refreshIntervalSeconds?: number;
}

export interface DatasetSelectionViewProps {
    datasets: DatasetMetadata[];
    handleSelectDataset: (datasetMetadata: DatasetMetadata) => void;
    handleSelectDatasetNewSession?: (datasetMetadata: DatasetMetadata) => void;
    hideRowNum?: boolean;
}

export const DatasetSelectionView: React.FC<DatasetSelectionViewProps> = function DatasetSelectionView({ datasets, handleSelectDataset, handleSelectDatasetNewSession, hideRowNum  }) {

    const [selectedDatasetName, setSelectedDatasetName] = useState<string | undefined>(undefined);
    const [tableActiveIndex, setTableActiveIndex] = useState<number>(0);

    useEffect(() => {
        if (datasets.length > 0) {
            setSelectedDatasetName(datasets[0].name);
        }
    }, [datasets]);

    // Reset table active index when dataset changes
    useEffect(() => {
        setTableActiveIndex(0);
    }, [selectedDatasetName]);

    const handleDatasetSelect = (index: number) => {
        setSelectedDatasetName(datasets[index].name);
    };

    let datasetTitles : string[] = [];
    for (let i = 0; i < datasets.length; i ++) {
        let k = 0;
        let title = datasets[i].name;
        while (datasetTitles.includes(title)) {
            k = k + 1;
            title = `${title}_${k}`;
        }
        datasetTitles.push(title);
    }

    // Convert dataset tables to DictTable objects for the preview
    const selectedDataset = datasets.find(d => d.name === selectedDatasetName);
    const previewTables: DictTable[] = useMemo(() => {
        if (!selectedDataset) return [];
        return selectedDataset.tables.map((table) => {
            const dictTable = createTableFromFromObjectArray(table.table_name, table.sample, true);
            // Use the table name from URL as displayId for better labeling
            const displayName = table.url.split("/").pop()?.split(".")[0]?.split("?")[0] || table.table_name;
            return {
                ...dictTable,
                displayId: displayName,
            };
        });
    }, [selectedDataset]);

    return (
        <Box sx={{ bgcolor: 'background.paper', display: 'flex', height: '100%', borderRadius: 2, overflow: 'hidden' }} >
            {/* Button navigation */}
            <Box sx={{ 
                minWidth: 180,
                maxWidth: 180,
                width: 180,
                display: 'flex',
                flexDirection: 'column',
                borderRight: `1px solid ${borderColor.view}`,
                overflow: 'hidden',
                height: '100%'
            }}>
                <Box sx={{ 
                    display: 'flex',
                    flexDirection: 'column',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    flex: 1,
                    minHeight: 0,
                    height: '100%',
                    position: 'relative',
                    overscrollBehavior: 'contain'
                }}>
                    {datasetTitles.map((title, i) => (
                        <Button
                            key={i}
                            variant="text"
                            size="small"
                            color='primary'
                            onClick={() => handleDatasetSelect(i)}
                            sx={{
                                fontSize: 12,
                                textTransform: "none",
                                width: 180,
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                borderRadius: 0,
                                py: 1,
                                px: 2,
                                color: selectedDatasetName === title ? 'primary.main' : 'text.secondary',
                                borderRight: selectedDatasetName === title ? 2 : 0,
                                borderColor: 'primary.main',
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {datasets[i]?.live && (
                                    <StreamIcon sx={{ fontSize: 14, color: 'success.main' }} />
                                )}
                                <span>{title}</span>
                            </Box>
                        </Button>
                    ))}
                </Box>
            </Box>

            {/* Content area */}
            <Box sx={{ flex: 1, overflow: 'hidden', minWidth: 0, minHeight: 0, height: '100%', position: 'relative' }}>
                <Box sx={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', p: 2, minWidth: 0, overscrollBehavior: 'contain' }}>
                    {selectedDataset && (
                        <Box>
                            <Box sx={{mb: 1, gap: 1, maxWidth: 800, display: "flex", alignItems: "center", flexWrap: "wrap"}}>
                                <Typography sx={{fontSize: 12, flex: 1, minWidth: 200}}>
                                    {selectedDataset.description} <Typography variant="caption" sx={{color: "primary.light", fontSize: 10, mx: 0.5}}>[from {selectedDataset.source}]</Typography>
                                </Typography>
                            </Box>
                            <Box sx={{ maxWidth: 800 }}>
                                <MultiTablePreview
                                    tables={previewTables}
                                    emptyLabel="No tables available."
                                    activeIndex={tableActiveIndex}
                                    onActiveIndexChange={setTableActiveIndex}
                                    maxHeight={280}
                                    maxRows={12}
                                    compact={false}
                                    showPreviewLabel={false}
                                    hideRowCount={hideRowNum}
                                />
                            </Box>
                            <Box sx={{display: 'flex', justifyContent: 'center', mt: 2, gap: 1}} >
                                <Button variant="contained" sx={{ width: 240, textTransform: 'none' }}
                                        onClick={(event: React.MouseEvent<HTMLElement>) => {
                                            handleSelectDataset(selectedDataset);
                                        }}>
                                    load dataset
                                </Button>
                                {handleSelectDatasetNewSession && (
                                    <Button variant="outlined" sx={{ width: 240, textTransform: 'none', color: 'text.secondary', borderColor: 'divider' }}
                                            onClick={(event: React.MouseEvent<HTMLElement>) => {
                                                handleSelectDatasetNewSession(selectedDataset);
                                            }}>
                                        load in new session
                                    </Button>
                                )}
                            </Box>
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
