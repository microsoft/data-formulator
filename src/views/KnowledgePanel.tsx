// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * KnowledgePanel — panel for browsing and editing knowledge items.
 *
 * Shows two collapsible sections: Rules (flat) and Experiences (flat).
 * Items are tagged for organization; no subdirectory grouping.
 * Supports search, edit, and delete. Rules can be created directly by
 * the user via the "+" affordance; experiences are produced by the
 * agent's distillation flow (see SaveExperienceButton).
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    TextField,
    InputAdornment,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Chip,
    Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import Editor from 'react-simple-code-editor';

import { useKnowledgeStore } from '../app/useKnowledgeStore';
import { deleteKnowledge, type KnowledgeCategory } from '../api/knowledgeApi';
import type { KnowledgeItem } from '../api/knowledgeApi';
import { borderColor, radius } from '../app/tokens';

// Default file name and seed body for a brand-new rule. Rules are plain
// Markdown — the user just edits the body; no front matter is required.
const DEFAULT_RULE_FILENAME = 'agent.md';
const RULE_TEMPLATE = `# Agent rules

Describe the constraints or conventions the agent should follow.
`;

// ── Main Component ───────────────────────────────────────────────────────

export const KnowledgePanel: React.FC = () => {
    const { t } = useTranslation();
    const store = useKnowledgeStore();

    const [searchQuery, setSearchQuery] = useState('');

    // Editor dialog state — used both for editing existing entries and
    // for creating new rules (in which case editorOriginalPath is empty).
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorCategory, setEditorCategory] = useState<KnowledgeCategory>('rules');
    const [editorPath, setEditorPath] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorOriginalPath, setEditorOriginalPath] = useState('');
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorLoading, setEditorLoading] = useState(false);

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

    // ── Editor ──────────────────────────────────────────────────────────

    const openCreateDialog = useCallback((category: KnowledgeCategory) => {
        setEditorCategory(category);
        setEditorPath(category === 'rules' ? DEFAULT_RULE_FILENAME : '');
        setEditorOriginalPath('');
        setEditorContent(category === 'rules' ? RULE_TEMPLATE : '');
        setEditorLoading(false);
        setEditorOpen(true);
    }, []);

    const openEditDialog = useCallback(async (category: KnowledgeCategory, item: KnowledgeItem) => {
        setEditorCategory(category);
        setEditorPath(item.path);
        setEditorOriginalPath(item.path);
        setEditorContent('');
        setEditorOpen(true);
        setEditorLoading(true);

        const content = await store.read(category, item.path);
        if (content !== null) {
            setEditorContent(content);
        }
        setEditorLoading(false);
    }, [store]);

    // Pending request to auto-open an entry once it appears in the store
    // (e.g. after the SaveExperienceButton finishes distilling).
    const pendingOpenRef = useRef<{ category: KnowledgeCategory; path: string } | null>(null);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const category = (detail.category as KnowledgeCategory | undefined) ?? 'experiences';
            const path = detail.path as string | undefined;
            if (path) {
                pendingOpenRef.current = { category, path };
            }
        };
        window.addEventListener('open-knowledge-panel', handler);
        return () => window.removeEventListener('open-knowledge-panel', handler);
    }, []);

    // When the requested entry shows up in the store, open its editor.
    useEffect(() => {
        const pending = pendingOpenRef.current;
        if (!pending) return;
        const cat = store.stateMap[pending.category];
        if (!cat?.loaded) return;
        const item = cat.items.find(i => i.path === pending.path);
        if (!item) return;
        pendingOpenRef.current = null;
        openEditDialog(pending.category, item);
    }, [store.stateMap, openEditDialog]);

    const handleSave = useCallback(async () => {
        if (!editorPath.trim() || !editorContent.trim()) return;
        setEditorSaving(true);

        const fileName = editorPath.endsWith('.md') ? editorPath : `${editorPath}.md`;
        const path = fileName;
        const success = await store.save(editorCategory, path, editorContent);
        if (success && editorOriginalPath && path !== editorOriginalPath) {
            try { await deleteKnowledge(editorCategory, editorOriginalPath); } catch { /* best-effort */ }
        }
        setEditorSaving(false);
        if (success) {
            setEditorOpen(false);
        }
    }, [editorPath, editorOriginalPath, editorContent, editorCategory, store]);

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
    ) => {
        const displayName = item.path || item.title;
        return (
            <Box
                key={`${category}/${item.path}`}
                onClick={() => openEditDialog(category, item)}
                sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 0.75,
                    px: 1.5, py: 0.75,
                    cursor: 'pointer',
                    color: 'text.primary',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:hover .item-actions': { visibility: 'visible' },
                    userSelect: 'none',
                }}
            >
                <DescriptionOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.125 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 500, wordBreak: 'break-word' }}>
                        {displayName}
                    </Typography>
                    {item.tags.length > 0 && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, mt: 0.25 }}>
                            {item.tags.map(tag => (
                                <Chip
                                    key={tag}
                                    label={tag}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: 9, height: 14, '& .MuiChip-label': { px: 0.5 } }}
                                />
                            ))}
                        </Box>
                    )}
                </Box>
                {item.source === 'agent_summarized' && (
                    <Tooltip title={t('knowledge.sourceAgent')}>
                        <SmartToyOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', mt: 0.25 }} />
                    </Tooltip>
                )}
                <Box className="item-actions" sx={{ display: 'flex', visibility: 'hidden', mt: 0.125 }}>
                    <IconButton
                        size="small"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ category, path: item.path, title: item.title }); }}
                        sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                    >
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
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
        const count = state.items.length;

        return (
            <Box key={category}>
                <Box
                    sx={{
                        display: 'flex', alignItems: 'center',
                        px: 1.5, pt: 1, pb: 0.25,
                    }}
                >
                    <Typography sx={{ flex: 1, fontSize: 10, color: 'text.secondary', letterSpacing: 0.3, textTransform: 'uppercase' }}>
                        {label}
                    </Typography>
                    {category === 'rules' && (
                        <Tooltip title={t('knowledge.newItem')}>
                            <IconButton
                                size="small"
                                onClick={() => openCreateDialog(category)}
                                sx={{ p: 0.25, color: 'text.disabled', '&:hover': { color: 'text.primary' } }}
                            >
                                <AddIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>

                {state.loading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                        <CircularProgress size={16} />
                    </Box>
                )}
                {!state.loading && state.items.length === 0 && (
                    <Typography sx={{ fontSize: 11, color: 'text.disabled', px: 1.5, py: 0.75, fontStyle: 'italic' }}>
                        {t('knowledge.noItems')}
                    </Typography>
                )}
                {state.items.map(item => renderItem(category, item))}
            </Box>
        );
    }, [store.stateMap, renderItem, openCreateDialog, t]);

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
                        {renderCategorySection('experiences', t('knowledge.experiences'))}

                        {/* Empty state */}
                        {!store.rules.loading && !store.experiences.loading &&
                         store.rules.items.length === 0 && store.experiences.items.length === 0 && (
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
                <DialogTitle sx={{ fontSize: 15, pb: 0.5 }}>
                    {t('knowledge.editTitle')}
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: '8px !important' }}>
                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                        <TextField
                            size="small"
                            label={t('knowledge.fileName')}
                            placeholder={t('knowledge.fileNamePlaceholder')}
                            value={editorPath}
                            onChange={(e) => setEditorPath(e.target.value)}
                            sx={{ flex: 1, minWidth: 150, '& .MuiInputBase-input': { fontSize: 12 } }}
                            slotProps={{ inputLabel: { sx: { fontSize: 12 } } }}
                        />
                    </Box>

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
                    <Button
                        onClick={() => { setEditorOpen(false); setDeleteTarget({ category: editorCategory, path: editorOriginalPath, title: editorOriginalPath }); }}
                        color="error"
                        sx={{ textTransform: 'none', fontSize: 12, mr: 'auto' }}
                    >
                        {t('app.delete')}
                    </Button>
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
                            || !editorPath.trim()
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
