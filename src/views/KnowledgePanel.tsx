// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * KnowledgePanel — tree-view panel for browsing and editing knowledge items.
 *
 * Shows three collapsible sections: Rules (flat), Skills (one-level),
 * Experiences (one-level).  Supports search, create, edit, and delete.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    Collapse,
    TextField,
    InputAdornment,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Chip,
    MenuItem,
    Select,
    FormControl,
    FormControlLabel,
    Switch,
    InputLabel,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import Editor from 'react-simple-code-editor';

import { useKnowledgeStore } from '../app/useKnowledgeStore';
import type { KnowledgeCategory } from '../api/knowledgeApi';
import type { KnowledgeItem } from '../api/knowledgeApi';
import { borderColor, radius } from '../app/tokens';

// ── Types ────────────────────────────────────────────────────────────────

interface TreeGroup {
    name: string;
    items: KnowledgeItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function groupItems(items: KnowledgeItem[]): TreeGroup[] {
    const flat: KnowledgeItem[] = [];
    const grouped: Record<string, KnowledgeItem[]> = {};

    for (const item of items) {
        const parts = item.path.split('/');
        if (parts.length > 1) {
            const dir = parts[0];
            if (!grouped[dir]) grouped[dir] = [];
            grouped[dir].push(item);
        } else {
            flat.push(item);
        }
    }

    const result: TreeGroup[] = [];
    if (flat.length > 0) {
        result.push({ name: '', items: flat });
    }
    for (const [name, items] of Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))) {
        result.push({ name, items });
    }
    return result;
}

// ── Main Component ───────────────────────────────────────────────────────

export const KnowledgePanel: React.FC = () => {
    const { t } = useTranslation();
    const store = useKnowledgeStore();

    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
        new Set(['rules', 'skills', 'experiences']),
    );
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // Editor dialog state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
    const [editorCategory, setEditorCategory] = useState<KnowledgeCategory>('rules');
    const [editorPath, setEditorPath] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorOriginalPath, setEditorOriginalPath] = useState('');
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorLoading, setEditorLoading] = useState(false);

    // Rules-specific editor fields
    const [editorDescription, setEditorDescription] = useState('');
    const [editorAlwaysApply, setEditorAlwaysApply] = useState(true);

    // Delete confirmation
    const [deleteTarget, setDeleteTarget] = useState<{ category: KnowledgeCategory; path: string; title: string } | null>(null);
    const [deleting, setDeleting] = useState(false);

    // Fetch all on mount
    useEffect(() => {
        store.fetchAll();
    }, []);

    // ── Search ───────────────────────────────────────────────────────────

    const handleSearch = useCallback(() => {
        const q = searchQuery.trim();
        if (q) {
            store.search(q);
        } else {
            store.clearSearch();
        }
    }, [searchQuery, store]);

    const clearSearch = useCallback(() => {
        setSearchQuery('');
        store.clearSearch();
    }, [store]);

    // ── Category toggle ─────────────────────────────────────────────────

    const toggleCategory = useCallback((category: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(category)) next.delete(category);
            else next.add(category);
            return next;
        });
    }, []);

    const toggleGroup = useCallback((key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    // ── Editor ──────────────────────────────────────────────────────────

    const openCreateDialog = useCallback((category: KnowledgeCategory) => {
        setEditorMode('create');
        setEditorCategory(category);
        setEditorPath('');
        setEditorContent('');
        setEditorOriginalPath('');
        setEditorDescription('');
        setEditorAlwaysApply(true);
        setEditorOpen(true);
    }, []);

    const openEditDialog = useCallback(async (category: KnowledgeCategory, item: KnowledgeItem) => {
        setEditorMode('edit');
        setEditorCategory(category);
        setEditorPath(item.path);
        setEditorOriginalPath(item.path);
        setEditorContent('');
        setEditorDescription(item.description ?? '');
        setEditorAlwaysApply(item.alwaysApply ?? true);
        setEditorOpen(true);
        setEditorLoading(true);

        const content = await store.read(category, item.path);
        if (content !== null) {
            setEditorContent(content);
        }
        setEditorLoading(false);
    }, [store]);

    const patchRuleFrontMatter = useCallback((raw: string): string => {
        if (editorCategory !== 'rules') return raw;
        const fmMatch = raw.match(/^---[ \t]*\r?\n([\s\S]*?\r?\n)---[ \t]*\r?\n?/);
        if (fmMatch) {
            let fm = fmMatch[1];
            fm = fm.replace(/^description:.*$/m, '').replace(/^alwaysApply:.*$/m, '');
            fm = fm.replace(/\n{2,}/g, '\n').trim();
            fm += `\ndescription: "${editorDescription.replace(/"/g, '\\"')}"\nalwaysApply: ${editorAlwaysApply}\n`;
            return `---\n${fm}---\n` + raw.slice(fmMatch[0].length);
        }
        const header = `---\ndescription: "${editorDescription.replace(/"/g, '\\"')}"\nalwaysApply: ${editorAlwaysApply}\n---\n\n`;
        return header + raw;
    }, [editorCategory, editorDescription, editorAlwaysApply]);

    const handleSave = useCallback(async () => {
        if (!editorPath.trim() || !editorContent.trim()) return;
        setEditorSaving(true);

        const path = editorPath.endsWith('.md') ? editorPath : `${editorPath}.md`;
        const contentToSave = patchRuleFrontMatter(editorContent);
        const success = await store.save(editorCategory, path, contentToSave);
        setEditorSaving(false);
        if (success) {
            setEditorOpen(false);
        }
    }, [editorPath, editorContent, editorCategory, store, patchRuleFrontMatter]);

    const handleDelete = useCallback(async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        await store.remove(deleteTarget.category, deleteTarget.path);
        setDeleting(false);
        setDeleteTarget(null);
    }, [deleteTarget, store]);

    // ── Render section ──────────────────────────────────────────────────

    const isSearchActive = store.searchResults.length > 0 || store.searching;

    const renderItem = useCallback((
        category: KnowledgeCategory,
        item: KnowledgeItem,
        nested = false,
    ) => {
        const displayName = item.path.split('/').pop()?.replace('.md', '') || item.title;
        const isRule = category === 'rules';
        return (
            <Box
                key={`${category}/${item.path}`}
                onClick={() => openEditDialog(category, item)}
                sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 0.5,
                    pl: nested ? 5.5 : 3.5, pr: 1.5, py: 0.4,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:hover .item-actions': { visibility: 'visible' },
                    userSelect: 'none',
                }}
            >
                <DescriptionOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', mt: 0.25 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography noWrap sx={{ fontSize: 11, color: 'text.primary' }}>
                            {displayName}
                        </Typography>
                        {isRule && item.alwaysApply && (
                            <Tooltip title={t('knowledge.alwaysApply')}>
                                <PushPinOutlinedIcon sx={{ fontSize: 10, color: 'primary.main', opacity: 0.7 }} />
                            </Tooltip>
                        )}
                    </Box>
                    {isRule && item.description && (
                        <Typography noWrap sx={{ fontSize: 10, color: 'text.disabled', lineHeight: 1.3 }}>
                            {item.description}
                        </Typography>
                    )}
                </Box>
                {item.source === 'agent_summarized' && (
                    <Tooltip title={t('knowledge.sourceAgent')}>
                        <SmartToyOutlinedIcon sx={{ fontSize: 11, color: 'text.disabled' }} />
                    </Tooltip>
                )}
                <Box className="item-actions" sx={{ display: 'flex', visibility: 'hidden' }}>
                    <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ category, path: item.path, title: item.title }); }}
                        sx={{ p: 0.15, color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                    >
                        <DeleteOutlineIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                </Box>
            </Box>
        );
    }, [openEditDialog, t]);

    const renderCategorySection = useCallback((
        category: KnowledgeCategory,
        label: string,
    ) => {
        const state = store.stateMap[category];
        const isExpanded = expandedCategories.has(category);
        const groups = groupItems(state.items);
        const count = state.items.length;

        return (
            <Box key={category}>
                <Box
                    onClick={() => toggleCategory(category)}
                    sx={{
                        display: 'flex', alignItems: 'center', gap: 0.5,
                        px: 1.5, py: 0.75, cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                        userSelect: 'none',
                    }}
                >
                    {isExpanded
                        ? <ExpandMoreIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                        : <ChevronRightIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 600, flex: 1, color: 'text.primary' }}>
                        {label}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                        {count > 0 ? t('knowledge.itemCount', { count }) : ''}
                    </Typography>
                    <Tooltip title={t('knowledge.newItem')}>
                        <IconButton
                            size="small"
                            onClick={(e) => { e.stopPropagation(); openCreateDialog(category); }}
                            sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
                        >
                            <AddIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                    </Tooltip>
                </Box>

                <Collapse in={isExpanded}>
                    {state.loading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                            <CircularProgress size={16} />
                        </Box>
                    )}
                    {!state.loading && state.items.length === 0 && (
                        <Typography sx={{ fontSize: 11, color: 'text.disabled', pl: 3.5, pb: 1, fontStyle: 'italic' }}>
                            {t('knowledge.noItems')}
                        </Typography>
                    )}
                    {groups.map((group) => {
                        if (group.name === '') {
                            return group.items.map(item => renderItem(category, item));
                        }
                        const groupKey = `${category}/${group.name}`;
                        const groupExpanded = expandedGroups.has(groupKey);
                        return (
                            <Box key={groupKey}>
                                <Box
                                    onClick={() => toggleGroup(groupKey)}
                                    sx={{
                                        display: 'flex', alignItems: 'center', gap: 0.5,
                                        pl: 3, pr: 1.5, py: 0.5, cursor: 'pointer',
                                        '&:hover': { bgcolor: 'action.hover' },
                                        userSelect: 'none',
                                    }}
                                >
                                    {groupExpanded
                                        ? <ExpandMoreIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                                        : <ChevronRightIcon sx={{ fontSize: 12, color: 'text.disabled' }} />}
                                    <FolderOpenIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.6 }} />
                                    <Typography noWrap sx={{ fontSize: 11, fontWeight: 500, flex: 1, color: 'text.secondary' }}>
                                        {group.name}
                                    </Typography>
                                    <Typography sx={{ fontSize: 10, color: 'text.disabled' }}>
                                        {t('knowledge.itemCount', { count: group.items.length })}
                                    </Typography>
                                </Box>
                                <Collapse in={groupExpanded}>
                                    {group.items.map(item => renderItem(category, item, true))}
                                </Collapse>
                            </Box>
                        );
                    })}
                </Collapse>
            </Box>
        );
    }, [store.stateMap, expandedCategories, expandedGroups, toggleCategory, toggleGroup, openCreateDialog, renderItem, t]);

    // ── Main render ─────────────────────────────────────────────────────

    return (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Search box */}
            <Box sx={{ px: 1.5, pt: 0.5, pb: 0.5, flexShrink: 0 }}>
                <TextField
                    size="small"
                    fullWidth
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
                    placeholder={t('knowledge.searchPlaceholder')}
                    slotProps={{
                        input: {
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                                </InputAdornment>
                            ),
                            endAdornment: searchQuery ? (
                                <InputAdornment position="end" sx={{ gap: 0.25 }}>
                                    <IconButton size="small" onClick={handleSearch} sx={{ p: 0.25 }}>
                                        {store.searching
                                            ? <CircularProgress size={12} />
                                            : <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
                                    </IconButton>
                                    <IconButton size="small" onClick={clearSearch} sx={{ p: 0.25 }}>
                                        <ClearIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                                    </IconButton>
                                </InputAdornment>
                            ) : null,
                        },
                    }}
                    sx={{
                        '& .MuiInputBase-root': { fontSize: 12, height: 30, borderRadius: 1 },
                        '& .MuiInputBase-input': { py: 0.5, px: 0.5 },
                        '& .MuiInputBase-input::placeholder': { fontSize: 11 },
                    }}
                />
            </Box>

            {/* Content area */}
            <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
                {isSearchActive ? (
                    // Search results view
                    <Box>
                        {store.searching && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <CircularProgress size={20} />
                            </Box>
                        )}
                        {!store.searching && store.searchResults.length === 0 && (
                            <Typography sx={{ fontSize: 11, color: 'text.disabled', px: 1.5, py: 2, fontStyle: 'italic', textAlign: 'center' }}>
                                {t('knowledge.noSearchResults')}
                            </Typography>
                        )}
                        {store.searchResults.map((result, i) => (
                            <Box
                                key={`search-${i}`}
                                onClick={() => openEditDialog(result.category as KnowledgeCategory, {
                                    title: result.title,
                                    tags: result.tags,
                                    path: result.path,
                                    source: result.source,
                                    created: '',
                                })}
                                sx={{
                                    px: 1.5, py: 0.75, cursor: 'pointer',
                                    '&:hover': { bgcolor: 'action.hover' },
                                    borderBottom: `1px solid ${borderColor.divider}`,
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Chip label={result.category} size="small" sx={{ fontSize: 9, height: 16 }} />
                                    <Typography noWrap sx={{ fontSize: 12, fontWeight: 500 }}>
                                        {result.title}
                                    </Typography>
                                </Box>
                                {result.snippet && (
                                    <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {result.snippet.slice(0, 120)}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                    </Box>
                ) : (
                    // Tree view
                    <Box>
                        {renderCategorySection('rules', t('knowledge.rules'))}
                        {renderCategorySection('skills', t('knowledge.skills'))}
                        {renderCategorySection('experiences', t('knowledge.experiences'))}

                        {/* Empty state */}
                        {!store.rules.loading && !store.skills.loading && !store.experiences.loading &&
                         store.rules.items.length === 0 && store.skills.items.length === 0 && store.experiences.items.length === 0 && (
                            <Typography sx={{ fontSize: 11, color: 'text.disabled', px: 1.5, py: 3, textAlign: 'center', fontStyle: 'italic' }}>
                                {t('knowledge.emptyState')}
                            </Typography>
                        )}
                    </Box>
                )}
            </Box>

            {/* Editor dialog */}
            <Dialog
                open={editorOpen}
                onClose={() => { if (!editorSaving) setEditorOpen(false); }}
                maxWidth="md"
                fullWidth
                sx={{ '& .MuiDialog-paper': { maxHeight: '90vh' } }}
            >
                <DialogTitle sx={{ fontSize: 15, pb: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {editorMode === 'create' ? t('knowledge.createTitle') : t('knowledge.editTitle')}
                    {editorMode === 'edit' && editorOriginalPath && (
                        <Typography variant="caption" color="text.secondary">
                            {editorCategory}/{editorOriginalPath}
                        </Typography>
                    )}
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
                    {editorMode === 'create' && (
                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <InputLabel sx={{ fontSize: 12 }}>{t('knowledge.category')}</InputLabel>
                                <Select
                                    value={editorCategory}
                                    label={t('knowledge.category')}
                                    onChange={(e) => setEditorCategory(e.target.value as KnowledgeCategory)}
                                    sx={{ fontSize: 12 }}
                                >
                                    <MenuItem value="rules" sx={{ fontSize: 12 }}>{t('knowledge.rules')}</MenuItem>
                                    <MenuItem value="skills" sx={{ fontSize: 12 }}>{t('knowledge.skills')}</MenuItem>
                                    <MenuItem value="experiences" sx={{ fontSize: 12 }}>{t('knowledge.experiences')}</MenuItem>
                                </Select>
                            </FormControl>
                            <TextField
                                size="small"
                                label={t('knowledge.fileName')}
                                placeholder={t('knowledge.fileNamePlaceholder')}
                                value={editorPath}
                                onChange={(e) => setEditorPath(e.target.value)}
                                sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12 } }}
                                slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                            />
                        </Box>
                    )}

                    {editorCategory === 'rules' && !editorLoading && (
                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                            <TextField
                                size="small"
                                label={t('knowledge.description')}
                                placeholder={t('knowledge.descriptionPlaceholder', { max: store.limits.rule_description_max })}
                                value={editorDescription}
                                onChange={(e) => setEditorDescription(e.target.value)}
                                error={editorDescription.length > store.limits.rule_description_max}
                                helperText={editorDescription.length > store.limits.rule_description_max
                                    ? t('knowledge.charCountExceeded', { max: store.limits.rule_description_max, current: editorDescription.length })
                                    : `${editorDescription.length} / ${store.limits.rule_description_max}`}
                                sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 12 }, '& .MuiFormHelperText-root': { fontSize: 10 } }}
                                slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        size="small"
                                        checked={editorAlwaysApply}
                                        onChange={(e) => setEditorAlwaysApply(e.target.checked)}
                                    />
                                }
                                label={
                                    <Tooltip title={t('knowledge.alwaysApplyHint')} placement="top">
                                        <Typography sx={{ fontSize: 12 }}>{t('knowledge.alwaysApply')}</Typography>
                                    </Tooltip>
                                }
                                sx={{ ml: 0, mr: 0, flexShrink: 0 }}
                            />
                        </Box>
                    )}

                    {editorLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress size={24} />
                        </Box>
                    ) : (
                        <>
                            <Box sx={{
                                border: `1px solid ${borderColor.component}`,
                                borderRadius: radius.sm,
                                overflow: 'auto',
                                maxHeight: '60vh',
                                minHeight: 200,
                            }}>
                                <Editor
                                    value={editorContent}
                                    onValueChange={setEditorContent}
                                    highlight={(code) => code}
                                    padding={16}
                                    placeholder="# Title\n\nWrite your knowledge content in Markdown..."
                                    style={{
                                        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                                        fontSize: 12,
                                        lineHeight: 1.5,
                                        minHeight: 200,
                                        whiteSpace: 'pre-wrap',
                                        outline: 'none',
                                    }}
                                />
                            </Box>
                            {(() => {
                                const bodyLimit = store.limits[editorCategory as keyof typeof store.limits] as number | undefined;
                                if (!bodyLimit) return null;
                                const bodyLen = editorContent.trim().length;
                                const exceeded = bodyLen > bodyLimit;
                                return (
                                    <Typography sx={{
                                        fontSize: 10, textAlign: 'right',
                                        color: exceeded ? 'error.main' : bodyLen > bodyLimit * 0.9 ? 'warning.main' : 'text.disabled',
                                    }}>
                                        {exceeded
                                            ? t('knowledge.charCountExceeded', { max: bodyLimit, current: bodyLen })
                                            : t('knowledge.charCount', { max: bodyLimit, current: bodyLen })}
                                    </Typography>
                                );
                            })()}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    {editorMode === 'edit' && (
                        <Button
                            onClick={() => { setEditorOpen(false); setDeleteTarget({ category: editorCategory, path: editorOriginalPath, title: editorOriginalPath }); }}
                            color="error"
                            sx={{ textTransform: 'none', fontSize: 12, mr: 'auto' }}
                        >
                            {t('app.delete')}
                        </Button>
                    )}
                    <Button
                        onClick={() => setEditorOpen(false)}
                        disabled={editorSaving}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {t('app.cancel')}
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={
                            editorSaving
                            || !editorContent.trim()
                            || (editorMode === 'create' && !editorPath.trim())
                            || (editorCategory === 'rules' && editorDescription.length > store.limits.rule_description_max)
                            || editorContent.trim().length > (store.limits[editorCategory as keyof typeof store.limits] as number ?? Infinity)
                        }
                        variant="contained"
                        sx={{ textTransform: 'none', fontSize: 12 }}
                    >
                        {editorSaving ? t('knowledge.saving') : t('knowledge.save')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={!!deleteTarget} onClose={() => { if (!deleting) setDeleteTarget(null); }}>
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {deleteTarget ? t('knowledge.deleteConfirm', { title: deleteTarget.title }) : ''}
                </DialogTitle>
                <DialogContent>
                    <Typography sx={{ fontSize: 13 }}>
                        {t('knowledge.deleteConfirmBody')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)} disabled={deleting} sx={{ textTransform: 'none', fontSize: 12 }}>
                        {t('app.cancel')}
                    </Button>
                    <Button onClick={handleDelete} disabled={deleting} color="error" variant="contained" sx={{ textTransform: 'none', fontSize: 12 }}>
                        {deleting ? <CircularProgress size={14} /> : t('app.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
