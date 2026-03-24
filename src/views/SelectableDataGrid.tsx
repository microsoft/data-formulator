// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { shadow, transition } from '../app/tokens';
import { TableVirtuoso } from 'react-virtuoso';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { Box } from '@mui/system';

import { useTheme } from '@mui/material/styles';
import { alpha, Paper, Tooltip, CircularProgress, Fade } from "@mui/material";

import { Type } from '../data/types';
import { getIconFromType } from './ViewUtils';

import { IconButton, TableSortLabel, Typography } from '@mui/material';

import _ from 'lodash';
import * as d3 from 'd3-dsv';
import { FieldSource, FieldItem } from '../components/ComponentType';

import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { TableIcon } from '../icons';
import CasinoIcon from '@mui/icons-material/Casino';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { getUrls, fetchWithIdentity } from '../app/utils';
import { useDrag } from 'react-dnd';
import { useSelector } from 'react-redux';
import { DataFormulatorState } from '../app/dfSlice';

export interface ColumnDef {
    id: string;
    label: string;
    dataType: Type;
    minWidth?: number;
    width?: number;
    align?: 'right';
    format?: (value: number) => string | JSX.Element;
    source: FieldSource;
}

interface SelectableDataGridProps {
    tableId: string;
    tableName: string;
    rows: any[];
    rowCount: number;
    virtual: boolean;
    columnDefs: ColumnDef[];
}

function descendingComparator<T>(a: T, b: T, orderBy: keyof T) {
    if (b[orderBy] < a[orderBy]) {
        return -1;
    }
    if (b[orderBy] > a[orderBy]) {
        return 1;
    }
    return 0;
}

function getComparator<Key extends keyof any>(
    order: "asc" | "desc",
    orderBy: Key,
): (
    a: { [key in Key]: number | string },
    b: { [key in Key]: number | string },
) => number {
    return order === 'desc'
        ? (a, b) => descendingComparator(a, b, orderBy)
        : (a, b) => -descendingComparator(a, b, orderBy);
}

// Get color for field source hover highlight
function getColorForFieldSource(source: string | undefined, theme: any): string {
    if (!source) {
        return theme.palette.primary.main; // Default to primary for original fields
    }
    
    switch (source) {
        case "custom":
            return theme.palette.custom.main; // Orange for custom fields
        case "original":
        default:
            return theme.palette.primary.main; // Blue for original fields
    }
}

// Draggable header component
interface DraggableHeaderProps {
    columnDef: ColumnDef;
    orderBy: string | undefined;
    order: 'asc' | 'desc';
    onSortClick: () => void;
    tableId: string;
}

const DraggableHeader: React.FC<DraggableHeaderProps> = ({ 
    columnDef, orderBy, order, onSortClick, tableId 
}) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const conceptShelfItems = useSelector((state: DataFormulatorState) => state.conceptShelfItems);
    const tables = useSelector((state: DataFormulatorState) => state.tables);
    
    // Get semantic type from table metadata
    const table = tables.find(t => t.id === tableId);
    const semanticType = table?.metadata?.[columnDef.id]?.semanticType;
    
    // Find the corresponding FieldItem for this column
    // Try to find by name first, then by constructing the ID for original fields
    const field = conceptShelfItems.find(f => f.name === columnDef.id) || 
                  conceptShelfItems.find(f => f.id === `original--${tableId}--${columnDef.id}`);
    
    // Only make draggable if we have a field
    // react-dnd has a drag threshold, so clicks will still work for sorting
    const [{ isDragging }, dragSource, dragPreview] = useDrag(() => ({
        type: "concept-card",
        item: field ? { 
            type: 'concept-card', 
            fieldID: field.id, 
            source: "conceptShelf" 
        } : undefined,
        canDrag: !!field,
        collect: (monitor) => ({
            isDragging: monitor.isDragging(),
            handlerId: monitor.getHandlerId(),
        }),
    }), [field]);

    let backgroundColor: string;
    let borderBottomColor = theme.palette.primary.main;
    if (columnDef.source == "custom") {
        backgroundColor = theme.palette.custom.bgcolor || alpha(theme.palette.custom.main, 0.1);
        borderBottomColor = theme.palette.custom.main;
    } else {
        backgroundColor = theme.palette.primary.bgcolor || alpha(theme.palette.primary.main, 0.1);
        borderBottomColor = theme.palette.primary.main;
    }

    const opacity = isDragging ? 0.3 : 1;
    const cursorStyle = field ? (isDragging ? "grabbing" : "grab") : "default";
    
    // Enhanced background color on hover for draggable headers - based on field source (derived/original)
    const hoverBackgroundColor = field 
        ? alpha(getColorForFieldSource(field.source, theme), 0.1)
        : backgroundColor;
    
    // Determine sort icon
    const getSortIcon = () => {
        if (orderBy !== columnDef.id) {
            return <UnfoldMoreIcon sx={{ fontSize: 16 }} />;
        }
        return order === 'asc' 
            ? <ArrowUpwardIcon sx={{ fontSize: 16 }} />
            : <ArrowDownwardIcon sx={{ fontSize: 16 }} />;
    };

    return (
        <Box 
            className="data-view-header-container" 
            ref={dragPreview}
            sx={{ 
                backgroundColor: backgroundColor, 
                borderBottomColor, 
                borderBottomWidth: '2px', 
                borderBottomStyle: 'solid',
                opacity,
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
                transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
                // Ensure cursor applies to TableSortLabel and its children, but not IconButton
                '& .data-view-header-title, & .data-view-header-title *': {
                    cursor: cursorStyle,
                },
                ...(field && {
                    '&:hover': {
                        backgroundColor: hoverBackgroundColor,
                        boxShadow: shadow.md,
                    },
                }),
            }}
        >
            {/* Main content area - draggable for concepts, using original TableSortLabel structure */}
            <TableSortLabel
                ref={field ? dragSource : undefined}
                className="data-view-header-title"
                sx={{ 
                    display: "flex", 
                    flexDirection: "row", 
                    flex: 1,
                    width: 'calc(100% - 24px)',
                    cursor: cursorStyle, // Inherit cursor from parent
                    '& .MuiTableSortLabel-icon': {
                        display: 'none',
                    },
                }}
                active={orderBy === columnDef.id}
                direction={orderBy === columnDef.id ? order : 'asc'}
                onClick={(e) => {
                    // Prevent sort when dragging
                    if (!isDragging) {
                        e.stopPropagation();
                        onSortClick();
                    }
                }}
            >
                <span role="img" style={{ fontSize: "inherit", padding: "2px", display: "inline-flex", alignItems: "center" }}>
                    {getIconFromType(columnDef.dataType)}
                </span>
                <Tooltip 
                    title={semanticType ? (
                        <Typography sx={{ fontSize: 11 }}>
                            <b>{columnDef.label}</b>: <i>{semanticType}</i>
                        </Typography>
                    ) : ''}
                    arrow
                    placement="top"
                >
                    <Typography sx={{fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                        {columnDef.label}
                    </Typography>
                </Tooltip>
            </TableSortLabel>
            {/* Separate sort handler button */}
            <Tooltip title={<Typography sx={{fontSize: 10}}>{t('dataGrid.sortBy', { label: columnDef.label })}</Typography>}>
                <IconButton
                    size="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSortClick();
                    }}
                    sx={{
                        padding: '2px',
                        marginLeft: '4px',
                        marginRight: '2px',
                        opacity: orderBy === columnDef.id ? 1 : 0.5,
                        '&:hover': {
                            opacity: 1,
                            backgroundColor: alpha(theme.palette.action.hover, 0.2),
                        },
                    }}
                >
                    {getSortIcon()}
                </IconButton>
            </Tooltip>
        </Box>
    );
};

export const SelectableDataGrid: React.FC<SelectableDataGridProps> = ({ 
    tableId, rows, tableName, columnDefs, rowCount, virtual }) => {

    const { t } = useTranslation();
    const [orderBy, setOrderBy] = React.useState<string | undefined>(undefined);
    const [order, setOrder] = React.useState<'asc' | 'desc'>('asc');

    let theme = useTheme();

    const [rowsToDisplay, setRowsToDisplay] = React.useState<any[]>(rows);
    
    // Initialize as true to cover the initial mount delay
    const [isLoading, setIsLoading] = React.useState<boolean>(true);
    
    // Clear loading state after first render
    React.useEffect(() => {
        setIsLoading(false);
    }, []);

    React.useEffect(() => {
        if (orderBy && !isLoading) {
            setRowsToDisplay(rows.slice().sort(getComparator(order, orderBy)));
        } else {
            setRowsToDisplay(rows);
        }
    }, [rows, order, orderBy])

    const TableComponents = {
        Scroller: React.forwardRef<HTMLDivElement>((props, ref) => (
            <TableContainer {...props} ref={ref} />
        )),
        Table: ({ children, style, ...rest }: any) => (
            <Table {...rest} style={style} sx={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                    {columnDefs.map(col => (
                        <col key={col.id} style={col.id === '#rowId' ? { width: 56 } : undefined} />
                    ))}
                </colgroup>
                {children}
            </Table>
        ),
        TableHead: React.forwardRef<HTMLTableSectionElement>((props, ref) => (
            <TableHead {...props} ref={ref} className='table-header-container' style={{ display: 'table-header-group' }} />
        )),
        TableRow: (props: any) => {
            const index = props['data-index'];
            return <TableRow {...props} style={{backgroundColor: index % 2 == 0 ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.02)"}}/>
        },
        TableBody: React.forwardRef<HTMLTableSectionElement>((props, ref) => (
            <TableBody {...props} ref={ref} />
        )),
    }

    const handleDownload = async (format: 'csv' | 'tsv') => {
        const delimiter = format === 'tsv' ? '\t' : ',';
        const ext = format === 'tsv' ? 'tsv' : 'csv';
        const mime = format === 'tsv' ? 'text/tab-separated-values' : 'text/csv';

        if (virtual) {
            // Virtual table: fetch full data from server
            try {
                const response = await fetchWithIdentity(getUrls().EXPORT_TABLE_CSV, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ table_name: tableId, delimiter }),
                });
                if (!response.ok) throw new Error('Export failed');
                const blob = await response.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `${tableName}.${ext}`;
                a.click();
                URL.revokeObjectURL(a.href);
            } catch (error) {
                console.error('Error downloading table:', error);
            }
        } else {
            // Local table: export from in-memory rows
            const csvContent = d3.dsvFormat(delimiter).format(rows);
            const blob = new Blob([csvContent], { type: mime });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${tableName}.${ext}`;
            a.click();
            URL.revokeObjectURL(a.href);
        }
    };

    const fetchVirtualData = (sortByColumnIds: string[], sortOrder: 'asc' | 'desc') => {
        // Set loading to true when starting the fetch
        setIsLoading(true);

        let message = sortByColumnIds.length > 0 ? {
            table: tableId,
            size: 1000,
            method: sortOrder === 'asc' ? 'head' : 'bottom',
            order_by_fields: sortByColumnIds
        } : {
            table: tableId,
            size: 1000,
            method: 'random'
        }
        
        // Use the SAMPLE_TABLE endpoint with appropriate ordering
        fetchWithIdentity(getUrls().SAMPLE_TABLE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                setRowsToDisplay(data.rows);
            }
            // Set loading to false when done
            setIsLoading(false);
        })
        .catch(error => {
            console.error('Error fetching sorted table data:', error);
            // Ensure loading is set to false even on error
            setIsLoading(false);
        });
    };

    return (
        <Box className="table-container table-container-small"
            sx={{
                width: '100%',
                height: '100%',
                position: 'relative',
                "& .MuiTableCell-root": {
                    fontSize: 12, maxWidth: "120px", py: '2px', cursor: "default",
                    overflow: "clip", textOverflow: "ellipsis", whiteSpace: "nowrap"
                }
            }}>
            {/* Loading Overlay */}
            {isLoading && (
                <Box sx={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    right: 0,
                    zIndex: 10, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    padding: '8px',
                    height: '100%',
                    borderTopLeftRadius: '4px',
                    borderTopRightRadius: '4px'
                }}>
                    <CircularProgress size={24} sx={{ mr: 1, color: 'lightgray' }} />
                    <Typography variant="body2" color="text.secondary">{t('dataGrid.loading')}</Typography>
                </Box>
            )}
            <Fade in={!isLoading} timeout={{appear: 300, enter: 300, exit: 2000}}>
                <Box sx={{ flex: '1 1', display: 'flex', flexDirection: 'column' }}>
                    <TableVirtuoso
                            style={{ flex: '1 1' }}
                            data={rowsToDisplay}
                            components={TableComponents}
                            fixedHeaderContent={() => {
                        return (
                            <TableRow key='header-fixed' style={{ paddingRight: 0, marginRight: '17px', height: '24px'}}>
                                {columnDefs.map((columnDef, index) => {
                                    return (
                                        <TableCell
                                            className='data-view-header-cell'
                                            key={columnDef.id}
                                            align={columnDef.align}
                                            sx={{
                                                p: columnDef.id === '#rowId' ? '0 2px' : 0,
                                                minWidth: columnDef.minWidth,
                                                width: columnDef.width,
                                            }}
                                        >
                                            {columnDef.id === '#rowId' ? (
                                                <Box
                                                    className="data-view-header-container"
                                                    sx={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        borderBottomWidth: '2px',
                                                        borderBottomStyle: 'solid',
                                                        borderBottomColor: 'rgba(0,0,0,0.2)',
                                                        padding: '4px 4px',
                                                        margin: '0 2px 0 0',
                                                    }}
                                                >
                                                    <Typography
                                                        sx={{
                                                            fontSize: 12,
                                                            color: 'text.secondary',
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                    >
                                                        {columnDef.label}
                                                    </Typography>
                                                </Box>
                                            ) : (
                                                <DraggableHeader
                                                    columnDef={columnDef}
                                                    orderBy={orderBy}
                                                    order={order}
                                                    tableId={tableId}
                                                    onSortClick={() => {
                                                        let newOrder: 'asc' | 'desc' = 'asc';
                                                        let newOrderBy : string | undefined = columnDef.id;
                                                        if (orderBy === columnDef.id && order === 'asc') {
                                                            newOrder = 'desc';
                                                        } else if (orderBy === columnDef.id && order === 'desc') {
                                                            newOrder = 'asc';
                                                            newOrderBy = undefined;
                                                        } else {
                                                            newOrder = 'asc';
                                                        }

                                                        setOrder(newOrder);
                                                        setOrderBy(newOrderBy);
                                                        
                                                        if (virtual) {
                                                            fetchVirtualData(newOrderBy ? [newOrderBy] : [], newOrder);
                                                        }
                                                    }}
                                                />
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        )
                    }}
                    itemContent={(rowIndex, data) => {
                        return (
                            <>
                                {columnDefs.map((column, colIndex) => {
                                    let backgroundColor = "rgba(255,255,255,0.05)";
                                    // if (column.source == "custom") {
                                    //     backgroundColor = alpha(theme.palette.custom.main, 0.03);
                                    // } else {
                                    //     backgroundColor = "rgba(255,255,255,0.05)";
                                    // }

                                    return (
                                        <TableCell
                                            key={`col-${colIndex}-row-${rowIndex}`}
                                            sx={{backgroundColor}}
                                            align={column.align || 'left'}
                                        >
                                            {column.format
                                                ? column.format(data[column.id])
                                                : (data[column.id] != null && typeof data[column.id] === 'object'
                                                    ? String(data[column.id])
                                                    : data[column.id])}
                                        </TableCell>
                                    )
                                })}
                            </>
                        )
                    }}
                />
                </Box>
            </Fade>
            <Paper variant="outlined"
                sx={{ display: 'flex', flexDirection: 'row',  position: 'absolute', bottom: 6, right: 25 }}>
                <Box sx={{display: 'flex', alignItems: 'center', mx: 1}}>
                    <Typography sx={{display: 'flex', alignItems: 'center', fontSize: '12px'}}>
                        {virtual && <TableIcon sx={{width: 14, height: 14, mr: 1}}/> }
                        {t('dataGrid.rowCount', { count: rowCount })}
                    </Typography>
                    {virtual && rowCount > 10000 && (
                        <Tooltip title={t('dataGrid.viewRandomRows')}>
                            <IconButton 
                                size="small" 
                                color="primary" 
                                sx={{marginRight: 1}}
                                onClick={() => {
                                    fetchVirtualData([], 'asc');
                                }}
                            >
                                <CasinoIcon sx={{
                                    fontSize: 18, 
                                    '&:hover': {
                                        transform: 'rotate(180deg)'
                                    }
                                }} />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title={t('dataGrid.downloadAsCsv')}>
                        <IconButton 
                            size="small" 
                            color="primary" 
                            onClick={() => handleDownload('csv')}
                        >
                            <FileDownloadIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Paper>
        </Box >
    );
}
